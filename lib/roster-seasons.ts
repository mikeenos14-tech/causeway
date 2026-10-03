import { pool } from "./db";
import { getSkaterRosterStats, getGoalieRosterStats, type SkaterRosterRow, type GoalieRosterRow } from "./roster-data";

// A past season's roster stats for the Roster page's season picker: every
// player who played a regular-season game for the team that season.
//   2007-08 on: the site's own box-score tables
//   before:     nhl_skater_games / nhl_goalie_games (the NHL's boxscores,
//               checked game by game against the play-by-play; season
//               totals cross-checked against the NHL's official ones in
//               scripts/qa/check-history-rosters.ts)
// Untracked stats are null, never 0: shots and plus-minus before 1959-60,
// and the RTSS stats (hits, blocks, ice time, PP goals) before 2007-08 here.

export const SITE_DATA_FROM = "20072008";

export type PastGoalieRow = GoalieRosterRow & { ties: number };
export type PastRoster = {
  seasonId: string;
  skaters: SkaterRosterRow[];
  goalies: PastGoalieRow[];
  tracked: { shots: boolean; plusMinus: boolean; detail: boolean; goalies: boolean };
};

// Seasons with roster stats: 2007-08 on, plus earlier seasons once every one
// of the team's box rows that season is marked played/not from the NHL's
// game logs (until then GP can't be trusted, so the season isn't offered).
export async function getTeamRosterSeasons(teamId: number): Promise<string[]> {
  const { rows } = await pool.query(
    `select g.season,
            count(s.*) filter (where s.played is null)::int as unmarked
     from nhl_games g left join nhl_skater_games s on s.game_id = g.id and s.team_id = $1
     where g.game_type = 'regular' and (g.home_team_id = $1 or g.away_team_id = $1)
     group by g.season order by g.season desc`,
    [teamId],
  );
  return rows.filter((r) => r.season >= SITE_DATA_FROM || r.unmarked === 0).map((r) => r.season as string);
}

export async function getPastRoster(abbrev: string, teamId: number, seasonId: string): Promise<PastRoster> {
  if (seasonId >= SITE_DATA_FROM) {
    const [skaters, goalies] = await Promise.all([getSkaterRosterStats(abbrev, seasonId), getGoalieRosterStats(abbrev, seasonId)]);
    return { seasonId, skaters, goalies: goalies.map((g) => ({ ...g, ties: 0 })), tracked: { shots: true, plusMinus: true, detail: true, goalies: true } };
  }
  const [{ rows: sk }, { rows: gk }] = await Promise.all([
    pool.query(
      `select s.player_id as id, coalesce(p.full_name, 'Unknown player') as full_name, mode() within group (order by s.position) as position,
              count(*)::int as games, sum(s.goals)::int as goals, sum(s.assists)::int as assists, sum(s.goals + s.assists)::int as points,
              sum(s.pim)::int as pim, sum(s.sog)::int as shots, sum(s.plus_minus)::int as plus_minus,
              bool_and(s.sog is not null) as sog_all, bool_and(s.plus_minus is not null) as pm_all,
              exists (select 1 from players pp where pp.id = s.player_id) as has_page
       from nhl_skater_games s join nhl_games g on g.id = s.game_id left join nhl_players p on p.id = s.player_id
       where g.season = $1 and g.game_type = 'regular' and s.team_id = $2 and s.played
       group by s.player_id, p.full_name order by points desc, goals desc`,
      [seasonId, teamId],
    ),
    pool.query(
      `select x.player_id as id, coalesce(p.full_name, 'Unknown player') as full_name, count(*)::int as games,
              count(*) filter (where x.decision = 'W')::int as wins, count(*) filter (where x.decision = 'L')::int as losses,
              count(*) filter (where x.decision = 'OTL')::int as otl, count(*) filter (where x.decision = 'T')::int as ties,
              -- A shutout: no goals against, and the only goalie his team used.
              count(*) filter (where x.goals_against = 0 and not exists (
                select 1 from nhl_goalie_games o where o.game_id = x.game_id and o.team_id = x.team_id and o.player_id <> x.player_id))::int as shutouts,
              sum(x.saves)::int as saves, sum(x.shots_against)::int as shots_against, sum(x.goals_against)::int as goals_against, sum(x.toi_sec)::int as toi_seconds,
              exists (select 1 from players pp where pp.id = x.player_id) as has_page
       from nhl_goalie_games x join nhl_games g on g.id = x.game_id left join nhl_players p on p.id = x.player_id
       where g.season = $1 and g.game_type = 'regular' and x.team_id = $2
       group by x.player_id, p.full_name order by wins desc`,
      [seasonId, teamId],
    ),
  ]);
  const shots = sk.length > 0 && sk.every((r) => r.sog_all);
  const plusMinus = sk.length > 0 && sk.every((r) => r.pm_all);
  return {
    seasonId,
    skaters: sk.map((r) => ({
      id: Number(r.id),
      full_name: r.full_name,
      // Players from before 2007-08 have a page only if their career reached it.
      hasPage: r.has_page,
      position: r.position,
      games: r.games,
      goals: r.goals,
      assists: r.assists,
      points: r.points,
      plus_minus: plusMinus ? r.plus_minus : (null as unknown as number),
      pim: r.pim,
      shots: shots ? r.shots : (null as unknown as number),
      hits: null as unknown as number,
      blocks: null as unknown as number,
      pp_goals: null as unknown as number,
      toiSecondsPerGame: null as unknown as number,
      shootingPct: shots && r.shots > 0 ? r.goals / r.shots : null,
    })),
    goalies: gk.map((r) => ({
      ...r,
      id: Number(r.id),
      hasPage: r.has_page,
      savePct: Number(r.shots_against) > 0 ? Number(r.saves) / Number(r.shots_against) : null,
      gaa: Number(r.toi_seconds) > 0 ? (Number(r.goals_against) * 3600) / Number(r.toi_seconds) : null,
    })),
    tracked: { shots, plusMinus, detail: false, goalies: gk.length > 0 },
  };
}
