import { pool } from "./db";
import { getLatestSeasonId } from "./schedule-data";

export type SkaterRosterRow = {
  id: number;
  full_name: string;
  position: string | null;
  games: number;
  goals: number;
  assists: number;
  points: number;
  plus_minus: number;
  pim: number;
  shots: number;
  hits: number;
  blocks: number;
  pp_goals: number;
  toiSecondsPerGame: number;
  shootingPct: number | null;
};

export type GoalieRosterRow = {
  id: number;
  full_name: string;
  games: number;
  wins: number;
  losses: number;
  otl: number;
  shutouts: number;
  saves: number;
  shots_against: number;
  goals_against: number;
  toi_seconds: number;
  savePct: number | null;
  gaa: number | null;
};

// Every current-roster stat table on the site (team roster page, player
// season splits) reuses this same "whatever season is actually loaded"
// lookup from schedule-data, instead of each page re-deriving its own
// notion of "current season" — that drifted into three near-duplicate
// queries before (homepage, team page, schedule page) and got centralized.
export async function getRosterSeasonId(teamAbbrev: string) {
  return getLatestSeasonId(teamAbbrev);
}

export async function getSkaterRosterStats(teamAbbrev: string, seasonId: string): Promise<SkaterRosterRow[]> {
  // Cast every aggregate to int: pg returns sum()/count() as strings (they
  // come back as Postgres bigint, which node-postgres won't auto-parse to
  // a number to avoid precision loss on truly huge sums) — left as strings,
  // the client-side sort in RosterTable would compare them lexicographically
  // and put "100" ahead of "2" but behind "13". Found live: Pastrnak's
  // 100-point row landing between two 13- and 1-point rows.
  const { rows } = await pool.query(
    `select p.id, p.full_name, p.position,
            count(*)::int as games,
            coalesce(sum(sgs.goals),0)::int as goals,
            coalesce(sum(sgs.assists),0)::int as assists,
            coalesce(sum(sgs.points),0)::int as points,
            coalesce(sum(sgs.plus_minus),0)::int as plus_minus,
            coalesce(sum(sgs.penalty_minutes),0)::int as pim,
            coalesce(sum(sgs.shots),0)::int as shots,
            coalesce(sum(sgs.hits),0)::int as hits,
            coalesce(sum(sgs.blocked_shots),0)::int as blocks,
            coalesce(sum(sgs.pp_goals),0)::int as pp_goals,
            coalesce(sum(sgs.toi_seconds),0)::int as toi_seconds_total
     from skater_game_stats sgs
     join games g on g.id = sgs.game_id
     join teams t on t.id = sgs.team_id
     join players p on p.id = sgs.player_id
     where t.abbrev = $1 and g.season_id = $2 and g.game_type = 'regular'
     group by p.id, p.full_name, p.position
     order by points desc, goals desc`,
    [teamAbbrev, seasonId],
  );
  return rows.map((r) => ({
    ...r,
    toiSecondsPerGame: r.games > 0 ? Math.round(r.toi_seconds_total / r.games) : 0,
    shootingPct: r.shots > 0 ? r.goals / r.shots : null,
  }));
}

export async function getGoalieRosterStats(teamAbbrev: string, seasonId: string): Promise<GoalieRosterRow[]> {
  const { rows } = await pool.query(
    `select p.id, p.full_name,
            count(*)::int as games,
            coalesce(sum(case when ggs.decision = 'W' then 1 else 0 end),0)::int as wins,
            coalesce(sum(case when ggs.decision = 'L' then 1 else 0 end),0)::int as losses,
            coalesce(sum(case when ggs.decision = 'OTL' then 1 else 0 end),0)::int as otl,
            coalesce(sum(ggs.shutout::int),0)::int as shutouts,
            coalesce(sum(ggs.saves),0)::int as saves,
            coalesce(sum(ggs.shots_against),0)::int as shots_against,
            coalesce(sum(ggs.goals_against),0)::int as goals_against,
            coalesce(sum(ggs.toi_seconds),0)::int as toi_seconds
     from goalie_game_stats ggs
     join games g on g.id = ggs.game_id
     join teams t on t.id = ggs.team_id
     join players p on p.id = ggs.player_id
     where t.abbrev = $1 and g.season_id = $2 and g.game_type = 'regular'
     group by p.id, p.full_name
     order by wins desc`,
    [teamAbbrev, seasonId],
  );
  return rows.map((r) => ({
    ...r,
    savePct: Number(r.shots_against) > 0 ? Number(r.saves) / Number(r.shots_against) : null,
    gaa: Number(r.toi_seconds) > 0 ? (Number(r.goals_against) * 3600) / Number(r.toi_seconds) : null,
  }));
}
