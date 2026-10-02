import { getWpModel, type WpMetrics } from "./wp-model";
import { getEloMatchup } from "./elo-odds";
import { ELO, otFormat } from "../config/stats";
import { wpContext, buildCurve } from "./wp-curve";
import type { WpTimeline } from "./wp-game";
import type { LiveClock, LiveGame, LiveGoal } from "./live-game";
import type { WpCell, WpParams } from "./stats/wp";

// Live win probability for /api/live: the same model and curve code as a
// finished game's chart (lib/wp-curve.ts), fed by the NHL's live feed and
// each team's current Elo rating. Home side; the UI flips for the Bruins.

export type LiveWp = {
  now: number; // home team's chance right now (from the scoreboard's score)
  timeline: WpTimeline | null; // null when the feed's goal list doesn't add up to the score (it flickers)
};

// Seconds of game time elapsed. The feed keeps the finished period's
// number through an intermission (its clock then counts the intermission
// down), so an intermission is pinned to the end of that period.
// Regular-season overtime is 5 minutes, playoff overtimes 20.
export function liveElapsed(c: LiveClock, playoff: boolean): number {
  if (c.periodType === "SO") return 3900;
  const len = c.periodType === "OT" && !playoff ? 300 : 1200;
  const start = c.period <= 3 ? (c.period - 1) * 1200 : 3600 + (c.period - 4) * 1200;
  if (c.inIntermission) return start + len;
  return start + len - Math.min(len, Math.max(0, c.secondsRemaining));
}

// A goal's game time from its period label ("1st", "OT", "2OT") and
// elapsed time in the period ("16:14"). Null if the feed's label is odd.
export function goalElapsed(goal: Pick<LiveGoal, "period" | "time">): number | null {
  const [m, s] = goal.time.split(":").map(Number);
  if (!Number.isFinite(m) || !Number.isFinite(s)) return null;
  const inPeriod = m * 60 + s;
  const reg = ["1st", "2nd", "3rd"].indexOf(goal.period);
  if (reg >= 0) return reg * 1200 + inPeriod;
  if (goal.period === "OT") return 3600 + inPeriod;
  const ot = /^(\d+)OT$/.exec(goal.period);
  if (ot) return 3600 + (Number(ot[1]) - 1) * 1200 + inPeriod;
  return null;
}

const STARTED = new Set(["LIVE", "CRIT", "OVER", "FINAL", "OFF"]);
const OVER = new Set(["OVER", "FINAL", "OFF"]);

// Pure, so the recorded games can replay through it (scripts/stats/test-wp.ts).
export function computeLiveWp(g: LiveGame, model: { version: string; params: WpParams; table: Map<string, WpCell>; metrics: WpMetrics }, gap: number): LiveWp | null {
  if (!STARTED.has(g.state) || (g.gameType !== 2 && g.gameType !== 3) || !g.clock) return null;
  const playoff = g.gameType === 3;
  const ctx = wpContext(model, g.season, playoff, gap);
  const over = OVER.has(g.state);
  const h = g.home.score, a = g.away.score;
  const final = over ? (h > a ? 1 : h < a ? 0 : 0.5) : null;

  const goals = g.goals.map((x) => ({ t: goalElapsed(x), home: x.team === g.home.abbrev, scorer: x.scorer, id: x.eventId }));
  const shootoutWinner = over && g.status.includes("SO") ? 1 : 0;
  const complete = goals.length === h + a - shootoutWinner && goals.every((x) => x.t != null);
  const lastGoal = Math.max(0, ...goals.map((x) => x.t ?? 0));
  const clockNow = liveElapsed(g.clock, playoff);
  // Final: the curve ends at the OT winner, the shootout, or 60:00.
  // Live: now (never before the latest goal, should the clock lag it).
  const end = over ? (g.status.includes("SO") ? 3900 : Math.max(3600, lastGoal)) : Math.max(clockNow, lastGoal);
  const now = final ?? ctx.at(end, h, a);
  if (!complete) return { now, timeline: null };

  const { points, biggestSwing } = buildCurve(ctx, goals as { t: number; home: boolean; scorer: string; id: number | null }[], end, final);
  return {
    now,
    timeline: {
      gameId: g.id,
      homeCode: g.home.abbrev,
      awayCode: g.away.abbrev,
      points,
      biggestSwing,
      tiesPossible: otFormat(g.season).tiesPossible && !playoff,
      modelVersion: model.version,
      pregame: points[0].p,
      endT: end,
      metrics: model.metrics,
      live: !over,
      playoff,
    },
  };
}

// The pregame gap, once per game per server instance (ratings don't move
// during a game; the daily rebuild runs in the morning).
const gaps = new Map<number, { gap: number; at: number }>();

export async function getLiveWp(g: LiveGame): Promise<LiveWp | null> {
  if (!STARTED.has(g.state) || (g.gameType !== 2 && g.gameType !== 3)) return null;
  const model = await getWpModel();
  if (!model) return null;
  let cached = gaps.get(g.id);
  if (!cached || Date.now() - cached.at > 3600_000) {
    const m = await getEloMatchup(g.awayId, g.homeId, g.startTimeUTC);
    if (!m) return null;
    const pen = ELO.params.b2bPenalty ?? 0;
    cached = { gap: m.homeRating - (m.b2b.home ? pen : 0) - (m.awayRating - (m.b2b.away ? pen : 0)), at: Date.now() };
    gaps.set(g.id, cached);
  }
  return computeLiveWp(g, model, cached.gap);
}
