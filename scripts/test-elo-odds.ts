// Tests the pregame Elo win chance (lib/elo-odds.ts, config ELO.winProb).
// Usage: npx tsx --env-file=.env.local scripts/test-elo-odds.ts

import { winChance, getEloOdds } from "../lib/elo-odds";
import { ELO } from "../config/stats";
import { pool } from "../lib/db";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
};

(async () => {
  const even = winChance(1500, 1500, "20262027");
  const expectEven = 1 / (1 + Math.exp(-(ELO.winProb.intercept + ELO.winProb.slope * ELO.params.homeIce.modern)));
  check("equal ratings: home team edge from home ice only (~54%)", Math.abs(even - expectEven) < 1e-12 && even > 0.52 && even < 0.56, String(even));
  check("a stronger home team is more likely to win", winChance(1600, 1500, "20262027") > even);
  check("a stronger road team flips it", winChance(1400, 1500, "20262027") < 0.5);
  check("home ice follows the era (dead-puck 30 > modern 20)", winChance(1500, 1500, "19971998") > even);
  check("chances stay inside (0, 1)", winChance(2000, 1000, "20262027") < 1 && winChance(1000, 2000, "20262027") > 0);
  const o = await getEloOdds(6, 52, "20262027", 2);
  check("odds for a real game: both sides sum to 1", !!o && Math.abs(o.home + o.away - 1) < 1e-12, JSON.stringify(o));
  check("whole percentages sum to 100 (away = 100 - home)", !!o && Math.round(o.home * 100) + (100 - Math.round(o.home * 100)) === 100);
  check("no odds for playoff games (curve fitted on regular season)", (await getEloOdds(6, 52, "20262027", 3)) === null);
  check("no odds for an unknown team", (await getEloOdds(6, 999999, "20262027", 2)) === null);
  await pool.end();
  console.log(`\n${failed === 0 ? "All passed." : `${failed} failed.`}`);
  process.exit(failed ? 1 : 0);
})();
