// Elo ratings for every franchise lineage since 1917 (spec section 6, V1).
// Pure functions: games in, ratings out, so the engine is unit-tested and a
// rebuild is deterministic. Parameters come from config/stats.ts (ELO),
// tuned by scripts/stats/build-elo.ts.

export type EloGame = {
  id: number;
  season: string;
  date: string; // YYYY-MM-DD
  playoff: boolean;
  home: number; // lineage ids
  away: number;
  homeScore: number;
  awayScore: number;
  finalState: "REG" | "OT" | "SO" | "TIE";
};

export type EloParams = {
  initial: number; // founding teams
  expansionStart: number;
  leagueMean: number;
  kRegular: number;
  kPlayoff: number;
  homeIce: Record<string, number>; // per era id
  marginCoef: number; // M = 1 + marginCoef * ln(margin)
  reversion: number; // share pulled toward leagueMean each offseason
  otWinnerScore: number; // S for an OT/SO winner (loser gets 1 - this)
};

export type EloRow = { gameId: number; team: number; date: string; before: number; after: number; expected: number; result: number };

export function expectedHome(rHome: number, rAway: number, homeIce: number): number {
  return 1 / (1 + 10 ** (-(rHome + homeIce - rAway) / 400));
}

export function resultScore(g: EloGame, p: EloParams): number {
  if (g.finalState === "TIE" || g.homeScore === g.awayScore) return 0.5;
  const homeWon = g.homeScore > g.awayScore;
  if (g.finalState === "OT" || g.finalState === "SO") return homeWon ? p.otWinnerScore : 1 - p.otWinnerScore;
  return homeWon ? 1 : 0;
}

export function marginMultiplier(g: EloGame, p: EloParams): number {
  // OT and shootout games are one-goal games by definition (the shootout
  // "goal" isn't a margin), and a tie has no margin.
  if (g.finalState !== "REG") return 1;
  const margin = Math.abs(g.homeScore - g.awayScore);
  return margin >= 1 ? 1 + p.marginCoef * Math.log(margin) : 1;
}

/**
 * Runs Elo over games (any order; sorted here by date then id, so the
 * result is deterministic). eraOf maps a season to its era id for home ice.
 * Returns per-game rows for both teams and the final ratings.
 */
export function runElo(input: EloGame[], p: EloParams, eraOf: (season: string) => string, foundingSeason = "19171918") {
  const games = [...input].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const rating = new Map<number, number>();
  const rows: EloRow[] = [];
  let season = "";

  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    if (g.season !== season) {
      season = g.season;
      // Offseason reversion toward the mean (roster turnover).
      for (const [t, r] of rating) rating.set(t, r + p.reversion * (p.leagueMean - r));
      const teams = new Set<number>();
      for (let j = i; j < games.length && games[j].season === season; j++) teams.add(games[j].home).add(games[j].away);
      const newcomers = [...teams].filter((t) => !rating.has(t));
      for (const t of newcomers) rating.set(t, season === foundingSeason ? p.initial : p.expansionStart);
      // Rebalance so this season's league averages exactly leagueMean.
      // Expansion teams keep their below-average start; the incumbents
      // absorb the shift (spec: prevents inflation as teams join, and
      // drift when teams fold).
      const incumbents = season === foundingSeason ? [...teams] : [...teams].filter((t) => !newcomers.includes(t));
      const total = [...teams].reduce((s, t) => s + rating.get(t)!, 0);
      const shift = incumbents.length ? (p.leagueMean * teams.size - total) / incumbents.length : 0;
      for (const t of incumbents) rating.set(t, rating.get(t)! + shift);
    }

    const rh = rating.get(g.home)!;
    const ra = rating.get(g.away)!;
    const e = expectedHome(rh, ra, p.homeIce[eraOf(g.season)] ?? 0);
    const s = resultScore(g, p);
    const k = (g.playoff ? p.kPlayoff : p.kRegular) * marginMultiplier(g, p);
    const delta = k * (s - e);
    rating.set(g.home, rh + delta);
    rating.set(g.away, ra - delta);
    rows.push({ gameId: g.id, team: g.home, date: g.date, before: rh, after: rh + delta, expected: e, result: s });
    rows.push({ gameId: g.id, team: g.away, date: g.date, before: ra, after: ra - delta, expected: 1 - e, result: 1 - s });
  }
  return { rows, ratings: rating };
}

/** Log loss of the home expectation against the (possibly fractional) result. */
export function logLoss(rows: EloRow[], filter: (r: EloRow) => boolean = () => true): { loss: number; n: number } {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < rows.length; i += 2) {
    const r = rows[i]; // home row
    if (!filter(r)) continue;
    const e = Math.min(1 - 1e-9, Math.max(1e-9, r.expected));
    sum += -(r.result * Math.log(e) + (1 - r.result) * Math.log(1 - e));
    n++;
  }
  return { loss: n ? sum / n : NaN, n };
}

/**
 * Best-of-seven series simulator (spec: 10,000 series, 2-2-1-1-1 home
 * ice). pHomeA / pHomeB: A's win chance in a game at A's rink / at B's.
 * Seeded so results are reproducible.
 */
export function simulateSeries(pAatHome: number, pAatAway: number, sims = 10_000, seed = 1) {
  let state = seed >>> 0 || 1;
  const rand = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const aHome = [true, true, false, false, true, false, true];
  let aWins = 0;
  const lengths = { 4: 0, 5: 0, 6: 0, 7: 0 } as Record<4 | 5 | 6 | 7, number>;
  for (let s = 0; s < sims; s++) {
    let a = 0;
    let b = 0;
    let game = 0;
    while (a < 4 && b < 4) {
      const p = aHome[game] ? pAatHome : pAatAway;
      if (rand() < p) a++;
      else b++;
      game++;
    }
    if (a === 4) aWins++;
    lengths[game as 4 | 5 | 6 | 7]++;
  }
  return { pA: aWins / sims, lengths: Object.fromEntries(Object.entries(lengths).map(([k, v]) => [k, v / sims])) as Record<string, number> };
}
