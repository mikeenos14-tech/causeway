// Compares Elo design variants on one shared yardstick: how well each
// predicts who WON (overtime and shootouts included; ties left out) in the
// held-out seasons (every fifth). Each variant's K, margin coefficient and
// offseason reversion are re-tuned on the training seasons only, by the
// same yardstick, and its win curve (a logistic on the Elo expectation's
// log-odds) is fitted on training seasons too.
//
// Variants: current design; FiveThirtyEight-style autocorrelation damping
// of big wins by favorites; margins without empty-net goals (known from
// 2009-10); shootout wins scored apart from OT wins; no margin at all.
//
// Usage: npx tsx --env-file=.env.local scripts/stats/experiment-elo.ts

import { Client } from "pg";
import { loadEloGames } from "./build-elo";
import { runElo, type EloGame, type EloParams } from "../../lib/stats/elo";
import { ELO, eraOf, isHeldOutSeason } from "../../config/stats";

const eraId = (s: string) => eraOf(s).id;
type Pt = { x: number; y: number; season: string };

function points(games: EloGame[], byId: Map<number, EloGame>, p: EloParams): Pt[] {
  const { rows } = runElo(games, p, eraId);
  const out: Pt[] = [];
  for (let i = 0; i < rows.length; i += 2) {
    const g = byId.get(rows[i].gameId)!;
    if (g.homeScore === g.awayScore) continue; // ties: no winner to predict
    const e = Math.min(1 - 1e-9, Math.max(1e-9, rows[i].expected));
    out.push({ x: Math.log(e / (1 - e)), y: g.homeScore > g.awayScore ? 1 : 0, season: g.season });
  }
  return out;
}

function fit(train: Pt[]): [number, number] {
  let a = 0, b = 1;
  for (let it = 0; it < 30; it++) {
    let ga = 0, gb = 0, haa = 0, hab = 0, hbb = 0;
    for (const t of train) {
      const p = 1 / (1 + Math.exp(-(a + b * t.x))), w = p * (1 - p);
      ga += t.y - p; gb += (t.y - p) * t.x; haa += w; hab += w * t.x; hbb += w * t.x * t.x;
    }
    const det = haa * hbb - hab * hab;
    a += (hbb * ga - hab * gb) / det; b += (haa * gb - hab * ga) / det;
  }
  return [a, b];
}

function score(pts: Pt[], ab: [number, number]) {
  let ll = 0, br = 0;
  for (const t of pts) {
    const p = Math.min(1 - 1e-9, Math.max(1e-9, 1 / (1 + Math.exp(-(ab[0] + ab[1] * t.x)))));
    ll -= t.y * Math.log(p) + (1 - t.y) * Math.log(1 - p);
    br += (p - t.y) ** 2;
  }
  return { ll: ll / pts.length, brier: br / pts.length, n: pts.length };
}

function evaluate(games: EloGame[], byId: Map<number, EloGame>, p: EloParams) {
  const pts = points(games, byId, p);
  const train = pts.filter((t) => !isHeldOutSeason(t.season));
  const ab = fit(train);
  const held = pts.filter((t) => isHeldOutSeason(t.season));
  return { trainLL: score(train, ab).ll, held: score(held, ab), heldModern: score(held.filter((t) => t.season >= "20092010"), ab) };
}

function tune(games: EloGame[], byId: Map<number, EloGame>, base: EloParams, margins = [0, 0.5, 1, 1.25, 1.5, 2]): EloParams {
  let best = base, bestLL = evaluate(games, byId, base).trainLL;
  for (const k of [4, 5, 6, 7, 8, 10])
    for (const marginCoef of margins)
      for (const reversion of [0.3, 0.4, 0.5]) {
        const p = { ...base, kRegular: k, kPlayoff: (k * 4) / 3, marginCoef, reversion };
        const ll = evaluate(games, byId, p).trainLL;
        if (ll < bestLL) [best, bestLL] = [p, ll];
      }
  return best;
}

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const games = await loadEloGames(c);
  await c.end();
  const byId = new Map(games.map((g) => [g.id, g]));
  const base: EloParams = { ...ELO.params };
  const variants: [string, EloParams][] = [
    ["current design", base],
    ["no margin bonus", { ...base, marginCoef: 0 }],
    ["autocorrelation damping", { ...base, autocorr: true }],
    ["margins without empty-net goals", { ...base, marginExcludesEmptyNet: true }],
    ["shootout win scored 0.6", { ...base, soWinnerScore: 0.6 }],
    ["shootout win scored 0.5", { ...base, soWinnerScore: 0.5 }],
    ["all three changes", { ...base, autocorr: true, marginExcludesEmptyNet: true, soWinnerScore: 0.6 }],
  ];
  const results = [];
  for (const [name, start] of variants) {
    const p = tune(games, byId, start, name === "no margin bonus" ? [0] : undefined);
    const r = evaluate(games, byId, p);
    results.push({ variant: name, K: p.kRegular, margin: p.marginCoef, reversion: p.reversion, heldOutLogLoss: +r.held.ll.toFixed(5), heldOutBrier: +r.held.brier.toFixed(5), since2009LogLoss: +r.heldModern.ll.toFixed(5), games: r.held.n });
    console.log(`done: ${name}`);
  }
  console.table(results);

  // Candidate additions, on the current settings plus the empty-net
  // margin: each new knob tuned on training seasons, then compared game by
  // game with that baseline on held-out seasons (mean log-loss gain and
  // its standard error). Adopt only at 2+ standard errors.
  const baseEN: EloParams = { ...base, marginExcludesEmptyNet: true };
  const heldLL = (p: EloParams) => {
    const pts = points(games, byId, p);
    const ab = fit(pts.filter((t) => !isHeldOutSeason(t.season)));
    const out = new Map<string, number>();
    for (const t of pts) if (isHeldOutSeason(t.season)) {
      const q = 1 / (1 + Math.exp(-(ab[0] + ab[1] * t.x)));
      out.set(`${t.season}|${t.x}|${t.y}|${out.size}`, -(t.y * Math.log(q) + (1 - t.y) * Math.log(1 - q)));
    }
    return [...out.values()];
  };
  const paired = (a: number[], b: number[]) => {
    const d = a.map((x, i) => x - b[i]);
    const m = d.reduce((s, x) => s + x, 0) / d.length;
    const se = Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / (d.length - 1) / d.length);
    return { gain: m, se, z: m / se };
  };
  const pickBest = (cands: EloParams[]) => cands.reduce((best, p) => (evaluate(games, byId, p).trainLL < evaluate(games, byId, best).trainLL ? p : best));
  const configOnly = heldLL(base), enOnly = heldLL(baseEN);
  console.log("empty-net margin vs current (same settings):", JSON.stringify(paired(configOnly, enOnly)));
  const b2b = pickBest([0, 10, 20, 30, 40, 50, 60].map((pen) => ({ ...baseEN, b2bPenalty: pen })));
  console.log(`back-to-back penalty tuned to ${b2b.b2bPenalty}:`, JSON.stringify(paired(enOnly, heldLL(b2b))));
  const early = pickBest([1].flatMap(() => [5, 10, 15, 20].flatMap((n) => [1, 1.25, 1.5, 2].map((mult) => ({ ...baseEN, earlyK: { games: n, mult } })))));
  console.log(`early-season K tuned to ${JSON.stringify(early.earlyK)}:`, JSON.stringify(paired(enOnly, heldLL(early))));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
