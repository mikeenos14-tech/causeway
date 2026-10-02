import { pool } from "./db";
import { GARBAGE_WPA, ASSIST_SHARE } from "./stats/leverage";

// Leverage Goals for the pages (stored by scripts/stats/build-leverage.ts):
// a player's clutch card, season and all-time leaderboards, and the
// Bruins' biggest goals.
//
// Clutch index: a player's Leverage Goals divided by what the same number
// of goals would be worth at the league's average WPA per goal in each
// season he scored them. 1.00 is league average for his own seasons, so
// it compares a 1950s scorer and a 2010s scorer fairly (a goal in a
// high-scoring season moves the chance less).

export const MIN_GOALS_TO_RANK = 20; // spec: Leverage per Goal ranks from 20 goals
export const MIN_CAREER_GOALS_FOR_PERCENTILE = 100;

const SEASON_AVG = `season_avg as (
  select season, game_type, sum(lg) / nullif(sum(goals), 0) avg_wpa from player_leverage group by season, game_type
)`;

export type ClutchCard = {
  regular: { goals: number; lg: number; perGoal: number; garbagePct: number; assistLg: number; index: number | null } | null;
  playoff: { goals: number; lg: number; playoffLg: number; perGoal: number } | null;
  percentile: number | null; // clutch index among players with 100+ regular-season goals
  rankedAmong: number;
  bestGoals: BigGoal[];
};

export type BigGoal = {
  gameId: number;
  date: string;
  season: string;
  playoff: boolean;
  team: string;
  opponent: string;
  period: number;
  periodType: string;
  timeInPeriod: number;
  before: number;
  after: number;
  wpa: number;
  stakes: number | null;
  scorer: string | null;
  scorerId: number | null;
  scoreAfter: string; // "BOS 4, TOR 4" from the scorer's side
};

const GOAL_SELECT = `
  select w.game_id, g.game_date::text date, g.season, g.game_type = 'playoff' playoff,
         st.tri_code team, case when e.team_id = g.home_team_id then at.tri_code else ht.tri_code end opponent,
         e.period, e.period_type, e.time_in_period_sec, w.wp_before::float before, w.wp_after::float after,
         (w.wp_after - w.wp_before)::float wpa, w.stakes::float stakes, p.full_name scorer, e.scorer_id,
         case when e.team_id = g.home_team_id then e.score_before_home + 1 else e.score_before_away + 1 end team_after,
         case when e.team_id = g.home_team_id then e.score_before_away else e.score_before_home end opp_after
  from goal_wpa w join nhl_goal_events e using (game_id, event_id) join nhl_games g on g.id = w.game_id
  join nhl_teams st on st.id = e.team_id join nhl_teams ht on ht.id = g.home_team_id join nhl_teams at on at.id = g.away_team_id
  left join nhl_players p on p.id = e.scorer_id`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toGoal = (r: any): BigGoal => ({
  gameId: r.game_id,
  date: r.date,
  season: r.season,
  playoff: r.playoff,
  team: r.team,
  opponent: r.opponent,
  period: r.period,
  periodType: r.period_type,
  timeInPeriod: r.time_in_period_sec,
  before: r.before,
  after: r.after,
  wpa: r.wpa,
  stakes: r.stakes,
  scorer: r.scorer,
  scorerId: r.scorer_id,
  scoreAfter: `${r.team} ${r.team_after}, ${r.opponent} ${r.opp_after}`,
});

export async function getClutchCard(playerId: number): Promise<ClutchCard | null> {
  const [{ rows: totals }, { rows: pct }, { rows: best }] = await Promise.all([
    pool.query(
      `with ${SEASON_AVG}
       select l.game_type, sum(l.goals)::int goals, sum(l.lg)::float lg, sum(l.garbage_goals)::int garbage, sum(l.assist_lg)::float assist_lg,
              sum(l.playoff_lg)::float playoff_lg, (sum(l.lg) / nullif(sum(l.goals * a.avg_wpa), 0))::float idx
       from player_leverage l join season_avg a using (season, game_type) where l.player_id = $1 group by l.game_type`,
      [playerId],
    ),
    pool.query(
      `with ${SEASON_AVG}, idx as (
         select l.player_id, sum(l.lg) / nullif(sum(l.goals * a.avg_wpa), 0) idx
         from player_leverage l join season_avg a using (season, game_type) where l.game_type = 'regular'
         group by l.player_id having sum(l.goals) >= $2
       )
       select (select count(*) from idx)::int n,
              (select count(*) from idx where idx < (select idx from idx where player_id = $1))::int below,
              exists (select 1 from idx where player_id = $1) ranked`,
      [playerId, MIN_CAREER_GOALS_FOR_PERCENTILE],
    ),
    pool.query(`${GOAL_SELECT} where e.scorer_id = $1 order by w.wp_after - w.wp_before desc, w.game_id limit 5`, [playerId]),
  ]);
  const reg = totals.find((r) => r.game_type === "regular");
  const po = totals.find((r) => r.game_type === "playoff");
  if ((!reg || reg.goals === 0) && (!po || po.goals === 0)) return null;
  const p = pct[0];
  return {
    regular: reg && reg.goals > 0 ? { goals: reg.goals, lg: reg.lg, perGoal: reg.lg / reg.goals, garbagePct: reg.garbage / reg.goals, assistLg: reg.assist_lg, index: reg.idx } : null,
    playoff: po && po.goals > 0 ? { goals: po.goals, lg: po.lg, playoffLg: po.playoff_lg ?? 0, perGoal: po.lg / po.goals } : null,
    percentile: p.ranked ? p.below / Math.max(1, p.n - 1) : null,
    rankedAmong: p.n,
    bestGoals: best.map(toGoal),
  };
}

export type LeaderRow = { playerId: number; name: string; team: string | null; goals: number; lg: number; perGoal: number; garbagePct: number; assistLg: number; playoffLg: number | null; index: number | null };

export type LeaderSort = "lg" | "per" | "garbage" | "index";

// A season's (or all time's) leaders. season null = all time. Per-goal,
// garbage and index sorts need MIN_GOALS_TO_RANK goals (a season) or 100
// (all time).
export async function getLeverageLeaders(opts: { season: string | null; gameType: "regular" | "playoff"; sort: LeaderSort; limit?: number }): Promise<LeaderRow[]> {
  const min = opts.season ? MIN_GOALS_TO_RANK : MIN_CAREER_GOALS_FOR_PERCENTILE;
  const order = {
    lg: opts.gameType === "playoff" ? "playoff_lg desc nulls last" : "lg desc",
    per: "per_goal desc",
    garbage: "garbage_pct asc, goals desc",
    index: "idx desc nulls last",
  }[opts.sort];
  const needsMin = opts.sort !== "lg";
  const { rows } = await pool.query(
    `with ${SEASON_AVG},
     t as (
       select l.player_id, sum(l.goals)::int goals, sum(l.lg)::float lg, sum(l.garbage_goals)::int garbage, sum(l.assist_lg)::float assist_lg,
              sum(l.playoff_lg)::float playoff_lg, (sum(l.lg) / nullif(sum(l.goals * a.avg_wpa), 0))::float idx
       from player_leverage l join season_avg a using (season, game_type)
       where l.game_type = $1 and ($2::text is null or l.season = $2)
       group by l.player_id having sum(l.goals) > 0
     )
     select t.*, t.lg / t.goals per_goal, t.garbage::float / t.goals garbage_pct, p.full_name name,
            (select st.tri_code from nhl_goal_events e join nhl_games g on g.id = e.game_id join nhl_teams st on st.id = e.team_id
             where e.scorer_id = t.player_id and g.game_type = $1 and ($2::text is null or g.season = $2)
             group by st.tri_code order by count(*) desc limit 1) team
     from t join nhl_players p on p.id = t.player_id
     where ($3::boolean = false or t.goals >= $4)
     order by ${order}, t.player_id limit $5`,
    [opts.gameType, opts.season, needsMin, min, opts.limit ?? 25],
  );
  return rows.map((r) => ({ playerId: r.player_id, name: r.name, team: r.team, goals: r.goals, lg: r.lg, perGoal: r.per_goal, garbagePct: r.garbage_pct, assistLg: r.assist_lg, playoffLg: r.playoff_lg, index: r.idx }));
}

// Bruins all-time leaders, counting only goals (and assists) for Boston.
export async function getBruinsLeverageLeaders(gameType: "regular" | "playoff", sort: LeaderSort, limit = 25): Promise<LeaderRow[]> {
  const min = gameType === "playoff" ? MIN_GOALS_TO_RANK : MIN_CAREER_GOALS_FOR_PERCENTILE;
  const order = { lg: gameType === "playoff" ? "playoff_lg desc nulls last" : "lg desc", per: "per_goal desc", garbage: "garbage_pct asc, goals desc", index: "idx desc nulls last" }[sort];
  const { rows } = await pool.query(
    `with ${SEASON_AVG},
     bg as (
       select e.scorer_id, e.assist1_id, e.assist2_id, g.season, (w.wp_after - w.wp_before) wpa, w.stakes
       from goal_wpa w join nhl_goal_events e using (game_id, event_id) join nhl_games g on g.id = w.game_id
       where e.team_id = 6 and g.game_type = $1
     ),
     goals as (
       select scorer_id player_id, count(*)::int goals, sum(wpa)::float lg, count(*) filter (where wpa < $2)::int garbage,
              sum(wpa * stakes)::float playoff_lg, (sum(wpa) / nullif(sum(a.avg_wpa), 0))::float idx
       from bg join season_avg a on a.season = bg.season and a.game_type = $1 where scorer_id is not null group by scorer_id
     ),
     assists as (
       select player_id, sum(credit)::float assist_lg from (
         select assist1_id player_id, wpa * $6 credit from bg union all select assist2_id, wpa * $7 from bg
       ) x where player_id is not null group by player_id
     )
     select g.*, coalesce(a.assist_lg, 0) assist_lg, g.lg / g.goals per_goal, g.garbage::float / g.goals garbage_pct, p.full_name name
     from goals g left join assists a using (player_id) join nhl_players p on p.id = g.player_id
     where ($3 = 'lg' or g.goals >= $4)
     order by ${order}, g.player_id limit $5`,
    [gameType, GARBAGE_WPA, sort, min, limit, ASSIST_SHARE.primary, ASSIST_SHARE.secondary],
  );
  return rows.map((r) => ({ playerId: r.player_id, name: r.name, team: "BOS", goals: r.goals, lg: r.lg, perGoal: r.per_goal, garbagePct: r.garbage_pct, assistLg: r.assist_lg, playoffLg: r.playoff_lg, index: r.idx }));
}

// The Bruins' biggest goals by win chance added (or, in the playoffs, by
// leverage: WPA times the game's series stakes).
export async function getBruinsBiggestGoals(kind: "wpa" | "playoff", limit = 50): Promise<BigGoal[]> {
  const order = kind === "playoff" ? "(w.wp_after - w.wp_before) * w.stakes desc" : "w.wp_after - w.wp_before desc";
  const { rows } = await pool.query(`${GOAL_SELECT} where e.team_id = 6 ${kind === "playoff" ? "and w.stakes is not null" : ""} order by ${order}, w.game_id limit $1`, [limit]);
  return rows.map(toGoal);
}

// Seasons for the leaderboard picker. The newest season joins once it has
// a third as many games as the season before, so the page doesn't open on
// a week-old season's handful of goals.
export async function getLeverageSeasons(): Promise<string[]> {
  const { rows } = await pool.query(
    `select g.season, count(*)::int n from leverage_games l join nhl_games g on g.id = l.game_id where g.game_type = 'regular' group by g.season order by g.season desc`,
  );
  return rows.filter((r, i) => i > 0 || rows.length < 2 || r.n >= rows[1].n / 3).map((r) => r.season);
}

export { GARBAGE_WPA };

// Which of these players have a page on the site (players table); the
// rest are shown unlinked rather than linking to a 404.
export async function playersWithPages(ids: (number | null)[]): Promise<Set<number>> {
  const want = [...new Set(ids.filter((x): x is number => x != null))];
  if (!want.length) return new Set();
  const { rows } = await pool.query(`select id from players where id = any($1::int[])`, [want]);
  return new Set(rows.map((r) => Number(r.id)));
}
