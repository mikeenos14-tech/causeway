// Live game state from the NHL's gamecenter feed, trimmed to what the live
// scoreboard shows: score, shots, period and clock, power play, and the
// goals so far. Read by /api/live/[id] (cached ~15s at the edge, so every
// viewer shares one upstream request) and polled by components/LiveScoreboard.
// Nothing here is stored or narrated; the hourly refresh still loads the
// official box score after the game.

const API = "https://api-web.nhle.com/v1";

// OVER: the horn has gone but the result isn't official yet (up to a
// minute before FINAL on the recorded 2026-10-01 games). Shown as final.
export type LiveState = "FUT" | "PRE" | "LIVE" | "CRIT" | "OVER" | "FINAL" | "OFF";

export type LiveGoal = {
  eventId: number | null; // the feed's id for this goal; stable when the NHL corrects the time
  period: string; // "1st", "OT", "2OT"
  time: string; // elapsed in the period, "16:14"
  team: string; // abbrev
  scorer: string; // "JJ Peterka"
  scorerGoals: number | null; // season total after this goal
  assists: string[];
  strength: "PP" | "SH" | null;
  emptyNet: boolean;
  awayScore: number;
  homeScore: number;
};

export type LiveTeam = { abbrev: string; name: string; score: number; sog: number | null };

export type LiveClock = {
  period: number; // 1-3, 4 = first OT
  periodType: "REG" | "OT" | "SO";
  secondsRemaining: number; // in the period (in the intermission's countdown during one)
  inIntermission: boolean;
};

export type LiveGame = {
  id: number;
  state: LiveState;
  gameType: number; // 2 regular season, 3 playoffs
  season: string; // "20262027"
  awayId: number;
  homeId: number;
  clock: LiveClock | null;
  startTimeUTC: string;
  status: string; // "2nd · 12:34", "1st intermission", "Final (OT)"
  away: LiveTeam;
  home: LiveTeam;
  situation: string | null; // "BOS power play · 1:23"
  goals: LiveGoal[];
  fetchedAt: string;
};

const ORD = ["", "1st", "2nd", "3rd"];

export function periodLabel(p: { number: number; periodType: string } | undefined, regPeriods = 3): string {
  if (!p) return "";
  if (p.periodType === "SO") return "Shootout";
  if (p.periodType === "OT") {
    const n = p.number - regPeriods;
    return n > 1 ? `${n}OT` : "OT";
  }
  return ORD[p.number] ?? `${p.number}th`;
}

const name = (n?: { default?: string }) => n?.default ?? "";

/* eslint-disable @typescript-eslint/no-explicit-any -- the NHL feed is untyped JSON */
export function parseLanding(d: any): LiveGame {
  const state = d.gameState as LiveState;
  const period = periodLabel(d.periodDescriptor, d.regPeriods ?? 3);
  const live = state === "LIVE" || state === "CRIT";
  const final = state === "FINAL" || state === "OFF" || state === "OVER";
  let status: string;
  if (final) {
    const t = d.periodDescriptor?.periodType;
    status = t === "OT" ? "Final (OT)" : t === "SO" ? "Final (SO)" : "Final";
  } else if (live) {
    if (d.clock?.inIntermission) status = `${period} intermission`;
    else if (d.periodDescriptor?.periodType === "SO") status = "Shootout";
    else status = `${period} · ${d.clock?.timeRemaining ?? ""}`;
  } else {
    status = state === "PRE" ? "Warmups" : "Not started";
  }

  const team = (t: any): LiveTeam => ({
    abbrev: t.abbrev,
    name: name(t.commonName) || t.abbrev,
    score: t.score ?? 0,
    sog: t.sog ?? null,
  });

  // Power play or an empty net, from the feed's situation block (present
  // only while live and only when it isn't 5-on-5).
  let situation: string | null = null;
  if (live && d.situation && !d.clock?.inIntermission) {
    for (const side of ["awayTeam", "homeTeam"] as const) {
      const s = d.situation[side];
      const descs: string[] = s?.situationDescriptions ?? [];
      const time = d.situation.timeRemaining ? ` · ${d.situation.timeRemaining}` : "";
      if (descs.includes("PP")) situation = `${s.abbrev} power play${time}`;
      else if (descs.includes("EN") && !situation) situation = `${s.abbrev} net empty`;
    }
  }

  const goals: LiveGoal[] = [];
  for (const p of d.summary?.scoring ?? []) {
    if (p.periodDescriptor?.periodType === "SO") continue; // shootout attempts aren't goals
    for (const g of p.goals ?? []) {
      // situationCode is away goalie, away skaters, home skaters, home
      // goalie; a 0 for the defending goalie is an empty-net goal.
      const code: string = g.situationCode ?? "";
      const defendingGoalie = g.isHome ? code[0] : code[3];
      goals.push({
        eventId: typeof g.eventId === "number" ? g.eventId : null,
        period: periodLabel(p.periodDescriptor, d.regPeriods ?? 3),
        time: g.timeInPeriod ?? "",
        team: name(g.teamAbbrev) || g.teamAbbrev,
        scorer: `${name(g.firstName)} ${name(g.lastName)}`.trim(),
        scorerGoals: g.goalsToDate ?? null,
        assists: (g.assists ?? []).map((a: any) => `${name(a.firstName)} ${name(a.lastName)}`.trim()),
        strength: g.strength === "pp" ? "PP" : g.strength === "sh" ? "SH" : null,
        emptyNet: g.goalModifier === "empty-net" || defendingGoalie === "0",
        awayScore: g.awayScore,
        homeScore: g.homeScore,
      });
    }
  }

  const pd = d.periodDescriptor;
  const clock: LiveClock | null =
    pd?.number && d.clock
      ? { period: pd.number, periodType: pd.periodType, secondsRemaining: Number(d.clock.secondsRemaining ?? 0), inIntermission: !!d.clock.inIntermission }
      : null;

  return {
    id: d.id,
    state,
    gameType: Number(d.gameType),
    season: String(d.season),
    awayId: Number(d.awayTeam?.id),
    homeId: Number(d.homeTeam?.id),
    clock,
    startTimeUTC: d.startTimeUTC,
    status,
    away: team(d.awayTeam),
    home: team(d.homeTeam),
    situation,
    goals,
    fetchedAt: new Date().toISOString(),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const LIVE_CACHE_SECONDS = 15;

export async function fetchLiveGame(gameId: number): Promise<LiveGame | null> {
  try {
    const res = await fetch(`${API}/gamecenter/${gameId}/landing`, { next: { revalidate: LIVE_CACHE_SECONDS } });
    if (!res.ok) return null;
    return parseLanding(await res.json());
  } catch {
    return null;
  }
}

// A goal's identity across polls: the feed's event id. Found on the first
// real games (2026-10-01): the NHL posts a goal with a provisional time and
// corrects it by a second or two about a minute later (11:10 -> 11:12), so
// a key that included the time saw every goal vanish and reappear: a false
// "overturned" note and a second goal light. A scoring change (credit
// moved to another player) keeps the id too; an overturned goal
// disappears with it. Period/time/team only if a feed ever lacks ids.
export const goalKey = (g: LiveGoal) => (g.eventId != null ? `e${g.eventId}` : `${g.period}|${g.time}|${g.team}`);

/**
 * What changed between two polls: goals that just appeared and goals that
 * vanished (overturned on review). Pure, so it's unit-tested.
 */
export function diffGoals(prev: LiveGoal[], next: LiveGoal[]): { added: LiveGoal[]; removed: LiveGoal[] } {
  const before = new Set(prev.map(goalKey));
  const after = new Set(next.map(goalKey));
  return { added: next.filter((g) => !before.has(goalKey(g))), removed: prev.filter((g) => !after.has(goalKey(g))) };
}

// Goal tracking across polls, robust to the NHL feed's flicker. On opening
// night (2026-10-01, recorded) the feed dropped a goal from its scoring
// list for 12-50 seconds while the SCORE still counted it (Jack Hughes's OT
// winner after the final horn; Dylan Guenther's 1st-period goal), then put
// it back. Treating "missing from the list" as overturned fired the goal
// light twice. Now:
//   - a missing goal is overturned only when its team's score has dropped
//     below the goals still credited to that team (a real overturn always
//     takes the goal off the scoreboard); otherwise it's kept, silently
//   - a goal that reappears after being called overturned is restored,
//     never celebrated again
export type GoalTracker = { known: LiveGoal[]; overturnedKeys: string[] };

export function startTracking(g: Pick<LiveGame, "goals">): GoalTracker {
  return { known: g.goals, overturnedKeys: [] };
}

export function trackGoals(
  state: GoalTracker,
  g: Pick<LiveGame, "goals" | "away" | "home">,
): { state: GoalTracker; added: LiveGoal[]; removed: LiveGoal[]; restored: LiveGoal[] } {
  const knownKeys = new Set(state.known.map(goalKey));
  const overturned = new Set(state.overturnedKeys);
  const nextByKey = new Map(g.goals.map((x) => [goalKey(x), x]));

  const added = g.goals.filter((x) => !knownKeys.has(goalKey(x)) && !overturned.has(goalKey(x)));
  const restored = g.goals.filter((x) => overturned.has(goalKey(x)));
  for (const x of restored) overturned.delete(goalKey(x));

  // Known goals carry forward with the feed's latest details (time
  // corrections, scoring changes); missing ones stay as they were.
  let known = [...state.known.map((x) => nextByKey.get(goalKey(x)) ?? x), ...added, ...restored];
  const removed: LiveGoal[] = [];
  for (const team of [g.away, g.home]) {
    const credited = known.filter((x) => x.team === team.abbrev);
    let excess = credited.length - team.score;
    // Only goals absent from the feed can be the overturned ones, latest first.
    const missing = credited.filter((x) => !nextByKey.has(goalKey(x))).reverse();
    for (const x of missing) {
      if (excess <= 0) break;
      removed.push(x);
      overturned.add(goalKey(x));
      excess--;
    }
  }
  const removedKeys = new Set(removed.map(goalKey));
  known = known.filter((x) => !removedKeys.has(goalKey(x)));
  return { state: { known, overturnedKeys: [...overturned] }, added, removed, restored };
}

// The goals to show, in game order: the tracker's list, so a goal the feed
// drops for a poll stays on the board (it once dropped the OT winner from
// the very update that first said "Final").
const PERIOD_ORDER = (p: string) => (p === "1st" ? 1 : p === "2nd" ? 2 : p === "3rd" ? 3 : p === "OT" ? 4 : /^\d+OT$/.test(p) ? 3 + Number(p.slice(0, -2)) : p === "SO" ? 99 : 50);
const SECONDS = (t: string) => Number(t.split(":")[0]) * 60 + Number(t.split(":")[1] ?? 0);
export function boardGoals(state: GoalTracker): LiveGoal[] {
  return [...state.known].sort((a, b) => PERIOD_ORDER(a.period) - PERIOD_ORDER(b.period) || SECONDS(a.time) - SECONDS(b.time));
}

// Final AND every goal on the board: the scoring list adds up to the score
// (a shootout's deciding goal counts in the score but not the list). Until
// then the scoreboard keeps polling, so a final missing a goal isn't frozen.
export function finalAndComplete(g: Pick<LiveGame, "state" | "status" | "away" | "home">, state: GoalTracker): boolean {
  if (g.state !== "FINAL" && g.state !== "OFF") return false;
  const expected = g.away.score + g.home.score - (g.status.includes("SO") ? 1 : 0);
  return state.known.length === expected;
}
