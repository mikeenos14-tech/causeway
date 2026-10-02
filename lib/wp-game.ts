import { pool } from "./db";
import { getWpModel } from "./wp-model";
import { winProbability, regulationOutcome, teamRates, type WpState, type WpOutcome } from "./stats/wp";
import { ELO, eraOf, otFormat } from "../config/stats";

// A finished game's win-probability curve from the home side: the pregame
// chance, every minute of regulation, the moments just before and after
// each goal, and the final. Built from the audited goal events and the
// pregame Elo gap, with the stored model (lib/wp-model.ts).
//
// `p` is the expected result: the win chance plus half the tie chance, so
// in eras with ties a tied game ends the curve at 50%, not 0. From 2005-06
// on (and in every playoff game) there are no ties and `p` is the plain
// win chance.

export type WpPoint = { t: number; p: number; goal?: { home: boolean; scorer: string | null; homeScore: number; awayScore: number } };
export type WpTimeline = {
  gameId: number;
  homeCode: string;
  awayCode: string;
  points: WpPoint[];
  biggestSwing: { t: number; from: number; to: number; home: boolean; scorer: string | null } | null;
  tiesPossible: boolean;
  modelVersion: string;
  pregame: number;
  endT: number; // where the curve ends: the winning OT goal, 65:00 for a shootout or a tie after OT, 70:00 for the 10-minute OT era
  metrics: import("./wp-model").WpMetrics;
};

export async function getGameWpTimeline(gameId: number): Promise<WpTimeline | null> {
  const model = await getWpModel();
  if (!model) return null;
  const { rows: [g] } = await pool.query(
    `select g.id, g.season, g.game_type = 'playoff' as playoff, g.home_team_id, g.away_team_id, g.home_score, g.away_score, g.final_state,
            ht.tri_code as home_code, at.tri_code as away_code,
            h.rating_before::float as rh, a.rating_before::float as ra,
            exists (select 1 from team_rest r where r.game_id = g.id and r.is_home and r.back_to_back) as b2b_h,
            exists (select 1 from team_rest r where r.game_id = g.id and not r.is_home and r.back_to_back) as b2b_a
     from nhl_games g join nhl_teams ht on ht.id = g.home_team_id join nhl_teams at on at.id = g.away_team_id
     left join elo_history h on h.game_id = g.id and h.franchise_id = ht.lineage_id
     left join elo_history a on a.game_id = g.id and a.franchise_id = at.lineage_id
     where g.id = $1`,
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
  const base: Omit<WpState, "elapsed" | "inOvertime" | "homeScore" | "awayScore"> = {
    era: eraOf(g.season).id,
    otRule: otFormat(g.season).label,
    playoff: g.playoff,
    gap: g.rh - (g.b2b_h ? pen : 0) - (g.ra - (g.b2b_a ? pen : 0)),
  };
  const rule = otFormat(g.season).label;
  const tenMinuteOt = !g.playoff && rule.startsWith("10-minute");
  const suddenDeathTies = !g.playoff && rule.startsWith("5-minute sudden death");
  const otLength = tenMinuteOt ? 600 : 300;
  const state = (t: number, h: number, a: number): WpState => ({ ...base, elapsed: Math.min(t, 3600), inOvertime: t >= 3600, homeScore: h, awayScore: a });
  const outcome = (t: number, h: number, a: number): WpOutcome => {
    if (t < 3600 || g.playoff) return winProbability(state(t, h, a), model.params, model.table);
    const left = Math.max(0, 3600 + otLength - t);
    if (tenMinuteOt) {
      // 1928-42: the full ten minutes are played, so a lead can be answered.
      const r = teamRates(model.params.eras[base.era], base.gap, model.params.strength);
      return regulationOutcome(h - a, r.home * left, r.away * left);
    }
    const o = winProbability(state(t, h, a), model.params, model.table);
    if (suddenDeathTies && h === a) {
      // 1983-2005: the measured chance of a goal in the full five minutes,
      // shrinking as overtime runs down; a scoreless OT is a tie.
      const tie = Math.pow(o.tie, left / 300);
      const homeShare = o.win / Math.max(1e-9, o.win + o.loss);
      return { win: (1 - tie) * homeShare, tie, loss: (1 - tie) * (1 - homeShare) };
    }
    return o;
  };
  const at = (t: number, h: number, a: number) => {
    const o = outcome(t, h, a);
    return { p: o.win + o.tie / 2 };
  };
  const points: WpPoint[] = [];
  let h = 0, a = 0, gi = 0;
  const lastGoal = Math.max(3600, ...goals.map((x) => Number(x.time_elapsed_sec)));
  // An overtime decided by a goal ends there; otherwise the curve runs to
  // the end of overtime (a tie, or the shootout).
  // (1928-42: every overtime ran the full ten minutes.)
  const wentToOt = g.final_state === "SO" || (g.final_state === "TIE" && (tenMinuteOt || suddenDeathTies)) || (tenMinuteOt && lastGoal > 3600);
  const end = wentToOt ? Math.max(lastGoal, 3600 + otLength) : lastGoal;
  // Goals up to time t: a point just before and just after each.
  const goalsThrough = (t: number) => {
    while (gi < goals.length && Number(goals[gi].time_elapsed_sec) <= t) {
      const x = goals[gi];
      const gt = Number(x.time_elapsed_sec);
      points.push({ t: gt, ...at(gt, h, a) });
      const isHome = Number(x.team_id) === Number(g.home_team_id);
      if (isHome) h++;
      else a++;
      points.push({ t: gt, ...at(gt, h, a), goal: { home: isHome, scorer: x.scorer, homeScore: h, awayScore: a } });
      gi++;
    }
  };
  for (let t = 0; t <= end; t += 60) {
    goalsThrough(t);
    if (t < end || t === 3600) points.push({ t, ...at(t, h, a) });
  }
  goalsThrough(end); // an overtime winner between minute marks
  // The final: who won (a tie is half).
  points.push({ t: end, p: g.home_score > g.away_score ? 1 : g.home_score < g.away_score ? 0 : 0.5 });

  let biggestSwing: WpTimeline["biggestSwing"] = null;
  for (let i = 1; i < points.length; i++) {
    const pt = points[i];
    if (!pt.goal) continue;
    const swing = pt.p - points[i - 1].p;
    if (!biggestSwing || Math.abs(swing) > Math.abs(biggestSwing.to - biggestSwing.from)) biggestSwing = { t: pt.t, from: points[i - 1].p, to: pt.p, home: pt.goal.home, scorer: pt.goal.scorer };
  }
  return { gameId, homeCode: g.home_code, awayCode: g.away_code, points, biggestSwing, tiesPossible: otFormat(g.season).tiesPossible && !g.playoff, modelVersion: model.version, pregame: points[0].p, endT: end, metrics: model.metrics };
}
