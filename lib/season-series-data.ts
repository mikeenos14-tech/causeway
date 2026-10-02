import { pool } from "./db";

export type SeasonSeriesRow = {
  opp_abbrev: string;
  opp_name: string;
  games: number;
  wins: number;
  losses: number;
  otl: number;
  last_meeting: string;
  // Each meeting, oldest first, so the page can link every game.
  meetings: { id: number; date: string; team_score: number; opp_score: number; end: string }[];
};

// Regular-season head-to-head record against every opponent actually
// played this season — the "season series" NHL broadcasts mean when they
// say "Boston leads the season series 3-1," distinct from a playoff
// series (playoff_series table, its own concept with its own record).
// Only counts played games (non-null scores) — a scheduled-but-unplayed
// game shouldn't count as part of the record.
export async function getAllSeasonSeriesForTeam(teamAbbrev: string, seasonId: string): Promise<SeasonSeriesRow[]> {
  const { rows } = await pool.query(
    `with per_game as (
       select g.id, g.game_date,
              case when ht.abbrev = $1 then g.home_score else g.away_score end as team_score,
              case when ht.abbrev = $1 then g.away_score else g.home_score end as opp_score,
              -- Carry the opponent's real team_id, not just its abbrev —
              -- abbrev isn't unique (found live: UTA matches both the
              -- Utah Mammoth and the since-renamed Utah Hockey Club
              -- franchise rows), so re-joining teams by abbrev string
              -- fans a game out into two rows and double-counts it under
              -- two different opponent names. team_id is the real key.
              case when ht.abbrev = $1 then g.away_team_id else g.home_team_id end as opp_team_id,
              g.game_end_type, g.ot_loser_point
       from games g
       join teams ht on ht.id = g.home_team_id
       join teams at on at.id = g.away_team_id
       where (ht.abbrev = $1 or at.abbrev = $1) and g.season_id = $2 and g.game_type = 'regular'
         and g.home_score is not null and g.away_score is not null
     )
     select t.abbrev as opp_abbrev, t.name as opp_name,
            count(*) as games,
            sum(case when pg.team_score > pg.opp_score then 1 else 0 end) as wins,
            sum(case when pg.team_score < pg.opp_score and (pg.game_end_type = 'regulation' or not pg.ot_loser_point) then 1 else 0 end) as losses,
            sum(case when pg.team_score < pg.opp_score and pg.game_end_type != 'regulation' and pg.ot_loser_point then 1 else 0 end) as otl,
            max(pg.game_date) as last_meeting,
            json_agg(json_build_object('id', pg.id, 'date', pg.game_date, 'team_score', pg.team_score, 'opp_score', pg.opp_score, 'end', pg.game_end_type) order by pg.game_date) as meetings
     from per_game pg
     join teams t on t.id = pg.opp_team_id
     group by pg.opp_team_id, t.abbrev, t.name
     order by games desc, t.abbrev asc`,
    [teamAbbrev, seasonId],
  );
  return rows;
}

export type PlayoffSeriesInfo = {
  round: number;
  opponentAbbrev: string;
  teamWins: number;
  opponentWins: number;
  winnerTeamId: number | null;
  gameNumber: number | null;
  // The series as it stood right after THIS game — what the game page shows.
  // (Whole-series totals on a Game 2 page, or "trails 2-4" on the page of
  // the game that ended the series, both read wrong.)
  teamWinsAfter: number;
  opponentWinsAfter: number;
  games: { id: number; gameDate: string; teamScore: number; opponentScore: number; gameNumber: number | null }[];
};

// For a playoff game specifically — the games table already links each
// playoff game to its series via series_id/series_game_number, so this
// is just walking that existing relationship, not a new data model.
export async function getPlayoffSeriesForGame(gameId: number, teamAbbrev: string): Promise<PlayoffSeriesInfo | null> {
  const { rows: seriesRows } = await pool.query(
    `select ps.id, ps.round, ps.team_a_id, ps.team_b_id, ps.winner_team_id
     from games g
     join playoff_series ps on ps.id = g.series_id
     where g.id = $1`,
    [gameId],
  );
  const series = seriesRows[0];
  if (!series) return null;

  const { rows: gameRows } = await pool.query(
    `select g.id, g.game_date, g.series_game_number,
            case when ht.abbrev = $2 then g.home_score else g.away_score end as team_score,
            case when ht.abbrev = $2 then g.away_score else g.home_score end as opp_score,
            case when ht.abbrev = $2 then at.abbrev else ht.abbrev end as opp_abbrev
     from games g
     join teams ht on ht.id = g.home_team_id
     join teams at on at.id = g.away_team_id
     where g.series_id = $1
     order by g.series_game_number asc`,
    [series.id, teamAbbrev],
  );

  const playedGames = gameRows.filter((g) => g.team_score != null && g.opp_score != null);
  const teamWins = playedGames.filter((g) => g.team_score > g.opp_score).length;
  const opponentWins = playedGames.filter((g) => g.opp_score > g.team_score).length;
  const currentGame = gameRows.find((g) => g.id === gameId);
  const throughThisGame = playedGames.filter((g) => currentGame && (g.series_game_number ?? 0) <= (currentGame.series_game_number ?? 0));

  return {
    round: series.round,
    opponentAbbrev: gameRows[0]?.opp_abbrev ?? "",
    teamWins,
    opponentWins,
    winnerTeamId: series.winner_team_id,
    gameNumber: currentGame?.series_game_number ?? null,
    teamWinsAfter: throughThisGame.filter((g) => g.team_score > g.opp_score).length,
    opponentWinsAfter: throughThisGame.filter((g) => g.opp_score > g.team_score).length,
    games: gameRows.map((g) => ({
      id: g.id,
      gameDate: g.game_date,
      teamScore: g.team_score,
      opponentScore: g.opp_score,
      gameNumber: g.series_game_number,
    })),
  };
}

// The regular-season series between this game's two teams as it stood
// right after this game — the "Boston leads the season series 2-1" a
// broadcast means that night. The game page once showed the end-of-season
// totals on every meeting's page (a January game read "trails 1-1-1, 3
// meetings" when only two had been played).
export async function getSeasonSeriesAsOfGame(gameId: number, teamAbbrev: string) {
  const { rows } = await pool.query(
    `with this_game as (
       select g.season_id, g.game_date, g.home_team_id, g.away_team_id from games g where g.id = $1
     ), meetings as (
       select g.id, g.game_date, g.game_end_type, g.ot_loser_point,
              case when ht.abbrev = $2 then g.home_score else g.away_score end as team_score,
              case when ht.abbrev = $2 then g.away_score else g.home_score end as opp_score
       from games g
       join this_game tg on tg.season_id = g.season_id
         and ((g.home_team_id = tg.home_team_id and g.away_team_id = tg.away_team_id)
           or (g.home_team_id = tg.away_team_id and g.away_team_id = tg.home_team_id))
       join teams ht on ht.id = g.home_team_id
       where g.game_type = 'regular' and g.game_date <= tg.game_date and g.home_score is not null
     )
     select count(*)::int as games,
            count(*) filter (where team_score > opp_score)::int as wins,
            count(*) filter (where team_score < opp_score and (game_end_type = 'regulation' or not ot_loser_point))::int as losses,
            count(*) filter (where team_score < opp_score and game_end_type <> 'regulation' and ot_loser_point)::int as otl
     from meetings`,
    [gameId, teamAbbrev],
  );
  const r = rows[0];
  return r && r.games > 0 ? (r as { games: number; wins: number; losses: number; otl: number }) : null;
}
