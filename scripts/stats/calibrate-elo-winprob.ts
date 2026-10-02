// Pregame win probability from Elo (spec section 6, "pregame Elo odds").
// Elo's own "expected" is an expected SCORE (OT win 0.75, tie 0.5), not a
// chance of winning, so the win chance is fitted separately: a logistic
// curve on the pregame rating gap (home ice included), from regular-season
// games since 2005-06 (no ties; OT and shootouts count as wins), training
// seasons only. Checked on the held-out seasons: calibration by bucket,
// log loss and Brier score against the no-skill baseline (home win rate).
//
// Usage: npx tsx --env-file=.env.local scripts/stats/calibrate-elo-winprob.ts

import { pool } from "../../lib/db";
import { ELO, eraOf, isHeldOutSeason } from "../../config/stats";

type G = { season: string; diff: number; homeWin: number };

async function main() {
  const { rows } = await pool.query(
    `select g.season, h.rating_before::float as rh, a.rating_before::float as ra, (g.home_score > g.away_score)::int as home_win
     from nhl_games g
     join nhl_teams ht on ht.id = g.home_team_id join nhl_teams at on at.id = g.away_team_id
     join elo_history h on h.game_id = g.id and h.franchise_id = ht.lineage_id
     join elo_history a on a.game_id = g.id and a.franchise_id = at.lineage_id
     where g.game_type = 'regular' and g.season >= '20052006' and g.home_score <> g.away_score`,
  );
  const homeIce = ELO.params.homeIce;
  // Home ice exactly as the Elo model applies it (by era, config ERAS).
  const games: G[] = rows.map((r) => ({ season: r.season, diff: r.rh - r.ra + (homeIce[eraOf(r.season).id] ?? 0), homeWin: r.home_win }));
  const train = games.filter((g) => !isHeldOutSeason(g.season));
  const test = games.filter((g) => isHeldOutSeason(g.season));

  // Logistic fit p = 1 / (1 + exp(-(a + b * diff))) by Newton's method.
  let a = 0, b = 0;
  for (let it = 0; it < 50; it++) {
    let ga = 0, gb = 0, haa = 0, hab = 0, hbb = 0;
    for (const g of train) {
      const p = 1 / (1 + Math.exp(-(a + b * g.diff)));
      const w = p * (1 - p);
      ga += g.homeWin - p; gb += (g.homeWin - p) * g.diff;
      haa += w; hab += w * g.diff; hbb += w * g.diff * g.diff;
    }
    const det = haa * hbb - hab * hab;
    a += (hbb * ga - hab * gb) / det;
    b += (haa * gb - hab * ga) / det;
  }
  const prob = (diff: number) => 1 / (1 + Math.exp(-(a + b * diff)));
  const base = train.reduce((s, g) => s + g.homeWin, 0) / train.length;
  const score = (set: G[], f: (g: G) => number) => {
    let ll = 0, br = 0;
    for (const g of set) { const p = Math.min(1 - 1e-9, Math.max(1e-9, f(g))); ll -= g.homeWin * Math.log(p) + (1 - g.homeWin) * Math.log(1 - p); br += (p - g.homeWin) ** 2; }
    return { ll: ll / set.length, brier: br / set.length };
  };
  console.log(`fit on ${train.length} training games: p(home win) = 1/(1+exp(-(${a.toFixed(4)} + ${b.toFixed(6)} x gap)))`);
  const m = score(test, (g) => prob(g.diff)), nb = score(test, () => base);
  console.log(`held-out ${test.length} games: log loss ${m.ll.toFixed(4)} vs ${nb.ll.toFixed(4)} baseline; Brier ${m.brier.toFixed(4)} vs ${nb.brier.toFixed(4)}`);
  console.log("calibration on held-out games (predicted vs actual home win rate):");
  const buckets = new Map<number, { n: number; p: number; w: number }>();
  for (const g of test) { const p = prob(g.diff); const k = Math.min(9, Math.floor(p * 20) - 5); const e = buckets.get(k) ?? { n: 0, p: 0, w: 0 }; e.n++; e.p += p; e.w += g.homeWin; buckets.set(k, e); }
  for (const [, e] of [...buckets.entries()].sort((x, y) => x[0] - y[0])) if (e.n >= 30) console.log(`  predicted ${(100 * e.p / e.n).toFixed(1)}%  actual ${(100 * e.w / e.n).toFixed(1)}%  (n=${e.n})`);
  const spread = test.map((g) => prob(g.diff));
  let ece = 0;
  const sorted = test.map((g) => ({ p: prob(g.diff), w: g.homeWin })).sort((x, y) => x.p - y.p);
  for (let i = 0; i < 10; i++) {
    const s = sorted.slice(Math.floor((i * sorted.length) / 10), Math.floor(((i + 1) * sorted.length) / 10));
    const p = s.reduce((t, x) => t + x.p, 0) / s.length, w = s.reduce((t, x) => t + x.w, 0) / s.length;
    ece += (Math.abs(p - w) * s.length) / sorted.length;
    console.log(`  decile ${i + 1}: predicted ${(100 * p).toFixed(1)}%  actual ${(100 * w).toFixed(1)}%`);
  }
  console.log(`expected calibration error: ${(100 * ece).toFixed(2)} points`);
  console.log(`range of predictions: ${(100 * Math.min(...spread)).toFixed(0)}%–${(100 * Math.max(...spread)).toFixed(0)}%`);
  await pool.end();
}

main();
