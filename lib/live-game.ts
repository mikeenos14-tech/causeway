// Live game state from the NHL's gamecenter feed, trimmed to what the live
// scoreboard shows: score, shots, period and clock, power play, and the
// goals so far. Read by /api/live/[id] (cached ~15s at the edge, so every
// viewer shares one upstream request) and polled by components/LiveScoreboard.
// Nothing here is stored or narrated; the hourly refresh still loads the
// official box score after the game.

const API = "https://api-web.nhle.com/v1";

export type LiveState = "FUT" | "PRE" | "LIVE" | "CRIT" | "FINAL" | "OFF";

export type LiveGoal = {
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

export type LiveGame = {
  id: number;
  state: LiveState;
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
  const final = state === "FINAL" || state === "OFF";
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

  return {
    id: d.id,
    state,
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

// A goal's identity across polls: period, time and team. A scoring change
// (credit moved to another player) keeps the key; an overturned goal
// disappears from the feed and its key with it.
export const goalKey = (g: LiveGoal) => `${g.period}|${g.time}|${g.team}`;

/**
 * What changed between two polls: goals that just appeared and goals that
 * vanished (overturned on review). Pure, so it's unit-tested.
 */
export function diffGoals(prev: LiveGoal[], next: LiveGoal[]): { added: LiveGoal[]; removed: LiveGoal[] } {
  const before = new Set(prev.map(goalKey));
  const after = new Set(next.map(goalKey));
  return { added: next.filter((g) => !before.has(goalKey(g))), removed: prev.filter((g) => !after.has(goalKey(g))) };
}
