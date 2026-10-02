import { winProbability, regulationOutcome, teamRates, type WpState, type WpOutcome, type WpParams, type WpCell } from "./stats/wp";
import { eraOf, otFormat } from "../config/stats";

// The win-probability curve for one game, shared by finished games
// (lib/wp-game.ts, from the audited goal events) and live games
// (lib/live-wp.ts, from the NHL feed), so the two always agree. Pure: no
// database, unit-tested in scripts/stats/test-wp.ts.
//
// `p` is the expected result from the home side: the win chance plus half
// the tie chance (from 2005-06 on, and in every playoff game, there are no
// ties and `p` is the plain win chance).

export type WpPoint = { t: number; p: number; goal?: { home: boolean; scorer: string | null; homeScore: number; awayScore: number } };
export type WpSwing = { t: number; from: number; to: number; home: boolean; scorer: string | null };
export type CurveGoal = { t: number; home: boolean; scorer: string | null };

export type WpGameContext = {
  at: (t: number, home: number, away: number) => number;
  otLength: number; // seconds of overtime in a regular-season game of this era (playoffs: 1200 per period)
  tenMinuteOt: boolean;
  suddenDeathTies: boolean;
};

// The chance at any moment of a game: seconds elapsed (3600+ is overtime),
// the score, and the pregame gap (home rating minus away rating, after any
// back-to-back penalty; home ice is in the era's scoring rates).
export function wpContext(model: { params: WpParams; table: Map<string, WpCell> }, season: string, playoff: boolean, gap: number): WpGameContext {
  const rule = otFormat(season).label;
  const base = { era: eraOf(season).id, otRule: rule, playoff, gap };
  const tenMinuteOt = !playoff && rule.startsWith("10-minute");
  const suddenDeathTies = !playoff && rule.startsWith("5-minute sudden death");
  const otLength = tenMinuteOt ? 600 : 300;
  const state = (t: number, h: number, a: number): WpState => ({ ...base, elapsed: Math.min(t, 3600), inOvertime: t >= 3600, homeScore: h, awayScore: a });
  const outcome = (t: number, h: number, a: number): WpOutcome => {
    if (t < 3600 || playoff) return winProbability(state(t, h, a), model.params, model.table);
    const left = Math.max(0, 3600 + otLength - t);
    if (tenMinuteOt) {
      // 1928-42: the full ten minutes are played, so a lead can be answered.
      const r = teamRates(model.params.eras[base.era], gap, model.params.strength);
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
  return {
    at: (t, h, a) => {
      const o = outcome(t, h, a);
      return o.win + o.tie / 2;
    },
    otLength,
    tenMinuteOt,
    suddenDeathTies,
  };
}

// Where a finished game's curve ends: an overtime decided by a goal ends
// there; otherwise the curve runs to the end of overtime (a tie, or the
// shootout). 1928-42: every overtime ran the full ten minutes.
export function finishedGameEnd(ctx: WpGameContext, finalState: string, goalTimes: number[]): number {
  const lastGoal = Math.max(3600, ...goalTimes);
  const wentToOt = finalState === "SO" || (finalState === "TIE" && (ctx.tenMinuteOt || ctx.suddenDeathTies)) || (ctx.tenMinuteOt && lastGoal > 3600);
  return wentToOt ? Math.max(lastGoal, 3600 + ctx.otLength) : lastGoal;
}

// Every minute up to `end`, a point just before and after each goal, and a
// last point at `end`: the result if the game is over (`final`: 1, 0, or
// 0.5 for a tie), else the chance right now.
export function buildCurve(ctx: WpGameContext, goals: CurveGoal[], end: number, final: number | null): { points: WpPoint[]; biggestSwing: WpSwing | null } {
  const sorted = [...goals].sort((x, y) => x.t - y.t);
  const points: WpPoint[] = [];
  let h = 0, a = 0, gi = 0;
  const goalsThrough = (t: number) => {
    while (gi < sorted.length && sorted[gi].t <= t) {
      const x = sorted[gi];
      points.push({ t: x.t, p: ctx.at(x.t, h, a) });
      if (x.home) h++;
      else a++;
      points.push({ t: x.t, p: ctx.at(x.t, h, a), goal: { home: x.home, scorer: x.scorer, homeScore: h, awayScore: a } });
      gi++;
    }
  };
  for (let t = 0; t <= end; t += 60) {
    goalsThrough(t);
    if (t < end || t === 3600) points.push({ t, p: ctx.at(t, h, a) });
  }
  goalsThrough(end); // an overtime winner between minute marks
  points.push({ t: end, p: final ?? ctx.at(end, h, a) });

  let biggestSwing: WpSwing | null = null;
  for (let i = 1; i < points.length; i++) {
    const pt = points[i];
    if (!pt.goal) continue;
    const swing = pt.p - points[i - 1].p;
    if (!biggestSwing || Math.abs(swing) > Math.abs(biggestSwing.to - biggestSwing.from)) biggestSwing = { t: pt.t, from: points[i - 1].p, to: pt.p, home: pt.goal.home, scorer: pt.goal.scorer };
  }
  return { points, biggestSwing };
}
