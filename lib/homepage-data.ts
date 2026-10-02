import { pool } from "./db";

// Simple team lookup, currently only for the team detail page header — get
// the display name and confirm the abbrev is real before running every
// other query for that page. Deliberately excludes the retired/renamed
// lineage duplicates (PHX, ARI, old-name UTA) via is_active, so a team
// page URL always resolves to the team's current identity.
export async function getTeam(teamAbbrev: string) {
  const { rows } = await pool.query(
    `select id, name, abbrev from teams where abbrev = $1 and is_active = true`,
    [teamAbbrev],
  );
  return rows[0] ?? null;
}

export type GameResult = {
  id: number;
  gameDate: string;
  gameType: string;
  homeAbbrev: string;
  awayAbbrev: string;
  homeScore: number;
  awayScore: number;
  gameEndType: string;
  isHome: boolean;
};

export async function getLatestGame(teamAbbrev: string) {
  // A game can have a 'highlights' row (something statistically notable),
  // a 'recap' row (the general-take fallback — most games), or neither yet
  // (not narrated at all). Prefer highlights when both exist.
  const { rows } = await pool.query(
    `select g.id, g.game_date, g.game_datetime, g.game_type, ht.abbrev as home_abbrev, at.abbrev as away_abbrev,
            g.home_score, g.away_score, g.game_end_type,
            coalesce(nh.headline, nr.headline) as headline,
            coalesce(nh.body, nr.body) as body
     from games g
     join teams ht on ht.id = g.home_team_id
     join teams at on at.id = g.away_team_id
     left join narratives nh on nh.game_id = g.id and nh.kind = 'highlights'
     left join narratives nr on nr.game_id = g.id and nr.kind = 'recap'
     where ht.abbrev = $1 or at.abbrev = $1
     order by g.game_date desc
     limit 1`,
    [teamAbbrev],
  );
  return rows[0] ?? null;
}

export type FormResult = "W" | "L" | "OT";

// Last N regular-season results within one season — the "Streak" tile's
// input. Scoped on purpose: it once ran across every game on file, so at
// the end of last season it paired a regular-season record with a streak
// ending in a playoff loss, and the first game of a new season would have
// continued a streak from the previous spring. OT/SO losses are their own
// result (the NHL's "OT" in a streak), not a plain L.
export async function getRecentForm(teamAbbrev: string, seasonId: string, count = 5): Promise<FormResult[]> {
  const { rows } = await pool.query(
    `select g.game_date, g.game_end_type,
            case when ht.abbrev = $1 then g.home_score else g.away_score end as team_score,
            case when ht.abbrev = $1 then g.away_score else g.home_score end as opp_score
     from games g
     join teams ht on ht.id = g.home_team_id
     join teams at on at.id = g.away_team_id
     where (ht.abbrev = $1 or at.abbrev = $1) and g.season_id = $2 and g.game_type = 'regular'
     order by g.game_date desc
     limit $3`,
    [teamAbbrev, seasonId, count],
  );
  return rows
    .reverse()
    .map((r) => (r.team_score > r.opp_score ? "W" : r.game_end_type === "regulation" ? "L" : "OT"));
}

// This team's standings row for a specific season — the same season every
// other homepage module uses (the season of the team's latest completed
// game). Once picked by newest snapshot_date instead, which would have
// flipped the Record tile to a new season's 0-0-0 row (written for all 32
// teams the night anyone plays) while the rest of the page still showed
// last season.
export async function getLatestStandings(teamAbbrev: string, seasonId: string) {
  const { rows } = await pool.query(
    `select ss.season_id, ss.division, ss.conference, ss.games_played, ss.wins, ss.losses, ss.ot_losses,
            ss.points, ss.points_pct, ss.division_rank, ss.conference_rank, ss.league_rank, ss.snapshot_date,
            ss.goals_for, ss.goals_against
     from standings_snapshots ss
     join teams t on t.id = ss.team_id
     where t.abbrev = $1 and ss.season_id = $2`,
    [teamAbbrev, seasonId],
  );
  return rows[0] ?? null;
}

// Full division table for the standings snapshot section — getLatestStandings
// above only returns this team's own row, not its rivals for comparison.
export async function getDivisionStandings(teamAbbrev: string, seasonId: string) {
  const own = await getLatestStandings(teamAbbrev, seasonId);
  if (!own) return null;
  const { rows } = await pool.query(
    `select t.abbrev, t.name, ss.wins, ss.losses, ss.ot_losses, ss.points, ss.division_rank
     from standings_snapshots ss
     join teams t on t.id = ss.team_id
     where ss.season_id = $1 and ss.division = $2
     order by ss.division_rank asc`,
    [own.season_id, own.division],
  );
  return {
    division: own.division,
    teams: rows,
    snapshotDate: own.snapshot_date,
    gamesPlayed: own.games_played,
    goalsFor: Number(own.goals_for),
    goalsAgainst: Number(own.goals_against),
    goalDiff: Number(own.goals_for) - Number(own.goals_against),
  };
}

export type RecentGameCard = {
  kind: "game";
  id: number;
  game_date: Date;
  is_home: boolean;
  opp_abbrev: string;
  team_score: number;
  opp_score: number;
  game_end_type: string;
};

export type RecentSeriesCard = {
  kind: "series";
  seriesId: number;
  round: number;
  opp_abbrev: string;
  teamWins: number;
  oppWins: number;
  decided: boolean;
  won: boolean;
  latestGameId: number;
  games: { id: number; team_score: number; opp_score: number }[];
};

export type RecentCard = RecentGameCard | RecentSeriesCard;

// "Recent results" cards for one season. Playoff games collapse into one
// card per series ("Lost First Round to BUF, 2-4") — four separate cards
// for four games of the same series said less than one card telling the
// story. Scoped to the season so a new season's first card never sits next
// to last spring's playoff games.
export async function getRecentResults(teamAbbrev: string, seasonId: string, count = 4): Promise<RecentCard[]> {
  const { rows } = await pool.query(
    `select g.id, g.game_date, g.game_type, g.game_end_type, g.series_id,
            (ht.abbrev = $1) as is_home,
            case when ht.abbrev = $1 then g.home_score else g.away_score end as team_score,
            case when ht.abbrev = $1 then g.away_score else g.home_score end as opp_score,
            case when ht.abbrev = $1 then at.abbrev else ht.abbrev end as opp_abbrev,
            ps.round, ps.winner_team_id, t.id as team_id
     from games g
     join teams ht on ht.id = g.home_team_id
     join teams at on at.id = g.away_team_id
     join teams t on t.abbrev = $1 and t.is_active
     left join playoff_series ps on ps.id = g.series_id
     where (ht.abbrev = $1 or at.abbrev = $1) and g.season_id = $2
     order by g.game_date desc`,
    [teamAbbrev, seasonId],
  );

  const cards: RecentCard[] = [];
  const seen = new Set<number>();
  for (const r of rows) {
    if (cards.length >= count) break;
    if (r.game_type === "playoff" && r.series_id != null) {
      if (seen.has(r.series_id)) continue;
      seen.add(r.series_id);
      const seriesGames = rows.filter((x) => x.series_id === r.series_id).reverse();
      const teamWins = seriesGames.filter((x) => x.team_score > x.opp_score).length;
      cards.push({
        kind: "series",
        seriesId: r.series_id,
        round: r.round,
        opp_abbrev: r.opp_abbrev,
        teamWins,
        oppWins: seriesGames.length - teamWins,
        decided: r.winner_team_id != null,
        won: r.winner_team_id === r.team_id,
        latestGameId: r.id,
        games: seriesGames.map((x) => ({ id: x.id, team_score: x.team_score, opp_score: x.opp_score })),
      });
    } else {
      cards.push({
        kind: "game",
        id: r.id,
        game_date: r.game_date,
        is_home: r.is_home,
        opp_abbrev: r.opp_abbrev,
        team_score: r.team_score,
        opp_score: r.opp_score,
        game_end_type: r.game_end_type,
      });
    }
  }
  return cards;
}

// Season stat leaders for the homepage's "Stat Leaders" cards — scoped to
// this team's most recently loaded season (not all-time), same "current
// year" scope the rest of the non-Ask site is meant to hold to now. Always
// the real current season, whatever its sample size — a low-game-count
// leader (e.g. "2 goals in 3 games") is genuinely accurate information,
// not something to hide or blend; every real hockey site shows exactly
// this in October without hedging it. The one real exception is the
// goalie minimum-games qualifier below, which is standard practice (the
// NHL's own save% leaderboard does the same) for a different reason: it's
// filtering out a tiny, noisy sample from a specific stat, not switching
// the season being shown.
export async function getStatLeaders(teamAbbrev: string, seasonId: string) {

  const { rows: pointsRows } = await pool.query(
    `select p.id, p.full_name, sum(sgs.goals) as goals, sum(sgs.assists) as assists, sum(sgs.points) as points
     from skater_game_stats sgs
     join games g on g.id = sgs.game_id
     join players p on p.id = sgs.player_id
     join teams t on t.id = sgs.team_id
     where t.abbrev = $1 and g.season_id = $2 and g.game_type = 'regular'
     group by p.id, p.full_name
     order by points desc
     limit 1`,
    [teamAbbrev, seasonId],
  );
  const { rows: goalsRows } = await pool.query(
    `select p.id, p.full_name, sum(sgs.goals) as goals
     from skater_game_stats sgs
     join games g on g.id = sgs.game_id
     join players p on p.id = sgs.player_id
     join teams t on t.id = sgs.team_id
     where t.abbrev = $1 and g.season_id = $2 and g.game_type = 'regular'
     group by p.id, p.full_name
     order by goals desc
     limit 1`,
    [teamAbbrev, seasonId],
  );
  const { rows: assistsRows } = await pool.query(
    `select p.id, p.full_name, sum(sgs.assists) as assists
     from skater_game_stats sgs
     join games g on g.id = sgs.game_id
     join players p on p.id = sgs.player_id
     join teams t on t.id = sgs.team_id
     where t.abbrev = $1 and g.season_id = $2 and g.game_type = 'regular'
     group by p.id, p.full_name
     order by assists desc
     limit 1`,
    [teamAbbrev, seasonId],
  );
  const { rows: plusMinusRows } = await pool.query(
    `select p.id, p.full_name, sum(sgs.plus_minus) as plus_minus
     from skater_game_stats sgs
     join games g on g.id = sgs.game_id
     join players p on p.id = sgs.player_id
     join teams t on t.id = sgs.team_id
     where t.abbrev = $1 and g.season_id = $2 and g.game_type = 'regular'
     group by p.id, p.full_name
     order by plus_minus desc
     limit 1`,
    [teamAbbrev, seasonId],
  );
  const { rows: hitsRows } = await pool.query(
    `select p.id, p.full_name, sum(sgs.hits) as hits
     from skater_game_stats sgs
     join games g on g.id = sgs.game_id
     join players p on p.id = sgs.player_id
     join teams t on t.id = sgs.team_id
     where t.abbrev = $1 and g.season_id = $2 and g.game_type = 'regular'
     group by p.id, p.full_name
     order by hits desc
     limit 1`,
    [teamAbbrev, seasonId],
  );
  const { rows: blocksRows } = await pool.query(
    `select p.id, p.full_name, sum(sgs.blocked_shots) as blocks
     from skater_game_stats sgs
     join games g on g.id = sgs.game_id
     join players p on p.id = sgs.player_id
     join teams t on t.id = sgs.team_id
     where t.abbrev = $1 and g.season_id = $2 and g.game_type = 'regular'
     group by p.id, p.full_name
     order by blocks desc
     limit 1`,
    [teamAbbrev, seasonId],
  );
  // Minimum 10 games played to keep a one-start backup goalie's small-sample
  // save% from dominating — not the same "minimum 50" convention used for
  // an all-time single-season record (a much bigger, completed-season
  // population); this is a current, possibly still-in-progress season.
  const { rows: goalieRows } = await pool.query(
    `select p.id, p.full_name, count(*) as games, sum(ggs.saves) as saves, sum(ggs.shots_against) as shots_against
     from goalie_game_stats ggs
     join games g on g.id = ggs.game_id
     join players p on p.id = ggs.player_id
     join teams t on t.id = ggs.team_id
     where t.abbrev = $1 and g.season_id = $2 and g.game_type = 'regular'
     group by p.id, p.full_name
     having count(*) >= 10
     order by (sum(ggs.saves)::numeric / nullif(sum(ggs.shots_against), 0)) desc
     limit 1`,
    [teamAbbrev, seasonId],
  );

  return {
    seasonId,
    points: pointsRows[0] ?? null,
    goals: goalsRows[0] ?? null,
    assists: assistsRows[0] ?? null,
    plusMinus: plusMinusRows[0] ?? null,
    hits: hitsRows[0] ?? null,
    blocks: blocksRows[0] ?? null,
    goalie: goalieRows[0] ? { ...goalieRows[0], savePct: Number(goalieRows[0].saves) / Number(goalieRows[0].shots_against) } : null,
  };
}

export type HomeRoadSplit = { wins: number; losses: number; otl: number; points: number; games: number };

// "Bruins are a different team at home" is a real, common storyline that
// the site had no way to actually check — this is the same games table
// already used everywhere else, just grouped by home/away instead of
// aggregated across both.
export async function getHomeRoadSplit(teamAbbrev: string, seasonId: string): Promise<{ home: HomeRoadSplit; away: HomeRoadSplit }> {
  const { rows } = await pool.query(
    `select (g.home_team_id = t.id) as is_home,
            sum(case when (g.home_team_id = t.id and g.home_score > g.away_score) or (g.away_team_id = t.id and g.away_score > g.home_score) then 1 else 0 end)::int as wins,
            sum(case when ((g.home_team_id = t.id and g.home_score < g.away_score) or (g.away_team_id = t.id and g.away_score < g.home_score)) and g.game_end_type = 'regulation' then 1 else 0 end)::int as losses,
            sum(case when ((g.home_team_id = t.id and g.home_score < g.away_score) or (g.away_team_id = t.id and g.away_score < g.home_score)) and g.game_end_type != 'regulation' then 1 else 0 end)::int as otl,
            count(*)::int as games
     from games g
     join teams t on t.id = g.home_team_id or t.id = g.away_team_id
     where t.abbrev = $1 and g.season_id = $2 and g.game_type = 'regular'
       and g.home_score is not null and g.away_score is not null
     group by is_home`,
    [teamAbbrev, seasonId],
  );
  const toSplit = (r: { wins: number; losses: number; otl: number; games: number } | undefined): HomeRoadSplit =>
    r ? { wins: r.wins, losses: r.losses, otl: r.otl, points: r.wins * 2 + r.otl, games: r.games } : { wins: 0, losses: 0, otl: 0, points: 0, games: 0 };
  return {
    home: toSplit(rows.find((r) => r.is_home)),
    away: toSplit(rows.find((r) => !r.is_home)),
  };
}

export type SeasonSummary = {
  seasonId: string;
  wins: number;
  losses: number;
  otl: number;
  points: number;
  divisionRank: number;
  division: string;
  // The team's last playoff series that season, or null if it didn't make
  // the playoffs (only stated as "missed" once the season is complete).
  lastSeries: { round: number; opp_abbrev: string; won: boolean; teamWins: number; oppWins: number } | null;
};

// One-line "how last season ended" — shown on the homepage before a new
// season's first game, when the stat tiles still describe that season.
export async function getSeasonSummary(teamAbbrev: string, seasonId: string): Promise<SeasonSummary | null> {
  const standing = await getLatestStandings(teamAbbrev, seasonId);
  if (!standing) return null;
  const { rows } = await pool.query(
    `select ps.id, ps.round, ps.winner_team_id, t.id as team_id,
            case when ps.team_a_id = t.id then tb.abbrev else ta.abbrev end as opp_abbrev,
            count(*) filter (where (case when g.home_team_id = t.id then g.home_score > g.away_score
                                         else g.away_score > g.home_score end)) as team_wins,
            count(g.id) as games
     from playoff_series ps
     join teams t on t.abbrev = $1 and t.is_active and t.id in (ps.team_a_id, ps.team_b_id)
     join teams ta on ta.id = ps.team_a_id
     join teams tb on tb.id = ps.team_b_id
     left join games g on g.series_id = ps.id
     where ps.season_id = $2
     group by ps.id, ps.round, ps.winner_team_id, t.id, ps.team_a_id, ta.abbrev, tb.abbrev
     order by ps.round desc
     limit 1`,
    [teamAbbrev, seasonId],
  );
  const s = rows[0];
  return {
    seasonId,
    wins: standing.wins,
    losses: standing.losses,
    otl: standing.ot_losses,
    points: standing.points,
    divisionRank: standing.division_rank,
    division: standing.division,
    lastSeries: s
      ? {
          round: s.round,
          opp_abbrev: s.opp_abbrev,
          won: s.winner_team_id === s.team_id,
          teamWins: Number(s.team_wins),
          oppWins: Number(s.games) - Number(s.team_wins),
        }
      : null,
  };
}
