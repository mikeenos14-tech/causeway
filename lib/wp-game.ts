import { pool } from "./db";
import { getWpModel, type WpMetrics } from "./wp-model";
import { wpContext, buildCurve, finishedGameEnd, type WpPoint, type WpSwing } from "./wp-curve";
import { ELO, otFormat } from "../config/stats";

// A finished game's win-probability curve from the home side: the pregame
// chance, every minute of regulation, the moments just before and after
// each goal, and the final. Built from the audited goal events and the
// pregame Elo gap, with the stored model (lib/wp-model.ts) and the shared
// curve code (lib/wp-curve.ts) that the live scoreboard uses too.

export type { WpPoint } from "./wp-curve";
export type WpTimeline = {
  gameId: number;
  homeCode: string;
  awayCode: string;
  points: WpPoint[];
  biggestSwing: WpSwing | null;
  tiesPossible: boolean;
  modelVersion: string;
  pregame: number;
  endT: number; // where the curve ends: the winning OT goal, 65:00 for a shootout or a tie after OT, 70:00 for the 10-minute OT era; live, the current moment
  metrics: WpMetrics;
  live?: boolean;
  playoff: boolean;
};

export async function getGameWpTimeline(gameId: number): Promise<WpTimeline | null> {
  const model = await getWpModel();
  if (!model) return null;
  const { rows: [g] } = await pool.query(
    `select g.id, g.season, g.game_type = 'playoff' as playoff, g.home_team_id, g.away_team_id, g.home_score, g.away_score, g.final_state,
            ht.tri_code as home_code, at.tri_code as away_code,
            coalesce(h.rating_before, case when ch.last_game_date < g.game_date then ch.rating end)::float as rh,
            coalesce(a.rating_before, case when ca.last_game_date < g.game_date then ca.rating end)::float as ra,
            coalesce((select bool_or(r.back_to_back) from team_rest r where r.game_id = g.id and r.is_home),
                     exists (select 1 from nhl_games p where g.home_team_id in (p.home_team_id, p.away_team_id) and p.game_date = g.game_date - 1)) as b2b_h,
            coalesce((select bool_or(r.back_to_back) from team_rest r where r.game_id = g.id and not r.is_home),
                     exists (select 1 from nhl_games p where g.away_team_id in (p.home_team_id, p.away_team_id) and p.game_date = g.game_date - 1)) as b2b_a
     from nhl_games g join nhl_teams ht on ht.id = g.home_team_id join nhl_teams at on at.id = g.away_team_id
     left join elo_history h on h.game_id = g.id and h.franchise_id = ht.lineage_id
     left join elo_history a on a.game_id = g.id and a.franchise_id = at.lineage_id
     -- Tonight's game, before the morning Elo rebuild: the current ratings,
     -- which are still pre-game as long as neither team has played since.
     left join elo_current ch on ch.franchise_id = ht.lineage_id
     left join elo_current ca on ca.franchise_id = at.lineage_id
     where g.id = $1 and g.game_type in ('regular', 'playoff')`,
    [gameId],
  );
  if (!g || g.rh == null || g.ra == null) return null;
  const { rows: goals } = await pool.query(
    `select e.period, e.period_type, e.time_elapsed_sec, e.team_id, p.full_name as scorer
     from nhl_goal_events e left join nhl_players p on p.id = e.scorer_id where e.game_id = $1 and e.period_type <> 'SO' order by e.time_elapsed_sec, e.event_id`,
    [gameId],
  );
  // Only a complete goal list (it adds up to the final score) gets a curve.
  const extra = g.final_state === "SO" ? 1 : 0;
  if (goals.length + extra !== g.home_score + g.away_score || goals.some((x) => x.time_elapsed_sec == null)) return null;

  const pen = ELO.params.b2bPenalty ?? 0;
  const gap = g.rh - (g.b2b_h ? pen : 0) - (g.ra - (g.b2b_a ? pen : 0));
  const ctx = wpContext(model, g.season, g.playoff, gap);
  const curveGoals = goals.map((x) => ({ t: Number(x.time_elapsed_sec), home: Number(x.team_id) === Number(g.home_team_id), scorer: x.scorer }));
  const end = finishedGameEnd(ctx, g.final_state, curveGoals.map((x) => x.t));
  // The final: who won (a tie is half).
  const { points, biggestSwing } = buildCurve(ctx, curveGoals, end, g.home_score > g.away_score ? 1 : g.home_score < g.away_score ? 0 : 0.5);
  return { gameId, homeCode: g.home_code, awayCode: g.away_code, points, biggestSwing, tiesPossible: otFormat(g.season).tiesPossible && !g.playoff, playoff: g.playoff, modelVersion: model.version, pregame: points[0].p, endT: end, metrics: model.metrics };
}
