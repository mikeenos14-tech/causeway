// Elo tests (spec section 6 acceptance criteria and section 13 unit
// tests). Unit cases always run; the history-dependent acceptance checks
// run against whatever history is loaded and say so when it's partial.
//
// Usage: npx tsx --env-file=.env.local scripts/stats/test-elo.ts

import { Client } from "pg";
import { expectedHome, marginMultiplier, resultScore, runElo, simulateSeries, type EloGame } from "../../lib/stats/elo";
import { ELO, eraOf } from "../../config/stats";
import { loadEloGames } from "./build-elo";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const p = ELO.params;
// Hand-worked unit cases pin their own inputs (the spec's starting values),
// so tuning the config can't silently change what they check.
const SPEC = { ...p, kRegular: 6, kPlayoff: 8, marginCoef: 0.5, homeIce: { early: 50 } as Record<string, number> };
const game = (over: Partial<EloGame>): EloGame => ({ id: 1, season: "20102011", date: "2010-10-10", playoff: false, home: 1, away: 2, homeScore: 3, awayScore: 2, finalState: "REG", ...over });

async function main() {
  // ---- Unit ----
  check("equal ratings, no home ice: 50%", expectedHome(1500, 1500, 0) === 0.5);
  check("equal ratings, 50 home ice: 57.15%", near(expectedHome(1500, 1500, 50), 0.5715, 0.0005));
  check("margin 1 multiplier is 1.0", marginMultiplier(game({ homeScore: 3, awayScore: 2 }), SPEC) === 1);
  check("margin 5 multiplier is 1 + 0.5 ln 5 = 1.805", near(marginMultiplier(game({ homeScore: 6, awayScore: 1 }), SPEC), 1.805, 0.001));
  check("OT win scores 0.75, OT loss 0.25", resultScore(game({ finalState: "OT" }), SPEC) === 0.75 && resultScore(game({ finalState: "OT", homeScore: 2, awayScore: 3 }), SPEC) === 0.25);
  check("shootout and tie scoring", resultScore(game({ finalState: "SO" }), SPEC) === 0.75 && resultScore(game({ finalState: "TIE", homeScore: 2, awayScore: 2 }), SPEC) === 0.5);
  const two = runElo([game({ season: "19171918", date: "1917-12-19" })], { ...SPEC, initial: 1505 }, () => "early");
  const delta = two.rows[0].after - two.rows[0].before;
  // v1.1 options (config: on)
  const EN = { ...SPEC, marginExcludesEmptyNet: true };
  check("empty-net goals leave the margin: 4-1 with 2 empty-netters is a 1-goal game", marginMultiplier(game({ homeScore: 4, awayScore: 1, enHome: 2 }), EN) === 1);
  check("empty-net goals unknown (before 2009-10): full margin", near(marginMultiplier(game({ homeScore: 4, awayScore: 1, enHome: null }), EN), 1 + 0.5 * Math.log(3), 1e-9));
  check("only the winner's empty-netters count (loser's don't shrink it)", near(marginMultiplier(game({ homeScore: 5, awayScore: 1, enHome: 0, enAway: 1 }), EN), 1 + 0.5 * Math.log(4), 1e-9));
  const b2bRun = runElo([game({ id: 9, season: "19171918", b2bHome: true })], { ...SPEC, b2bPenalty: 30 }, () => "early");
  check("back-to-back: the tired team's expectation uses its rating minus 30", near(b2bRun.rows[0].expected, expectedHome(1500 - 30, 1500, 50), 1e-12), String(b2bRun.rows[0].expected));
  check("config has the v1.1 options on (empty-net margin, 30-point back-to-back)", ELO.params.marginExcludesEmptyNet === true && ELO.params.b2bPenalty === 30);
  check("one home regulation win moves ratings by K * (1 - E)", near(delta, 6 * (1 - expectedHome(1505, 1505, 50)), 1e-9), String(delta));
  check("updates are zero-sum", near(two.rows[0].after + two.rows[1].after, 2 * 1505, 1e-9));

  // Series simulator: equal teams split; speed under 1 second.
  const t0 = performance.now();
  const even = simulateSeries(0.5, 0.5, 10_000);
  const ms = performance.now() - t0;
  check("even teams win about half their series", near(even.pA, 0.5, 0.02), String(even.pA));
  check("10,000-series simulation under 1 second", ms < 1000, `${ms.toFixed(0)} ms`);
  check("series lengths sum to 1", near(Object.values(even.lengths).reduce((s, x) => s + x, 0), 1, 1e-9));
  check("simulation is reproducible (seeded)", JSON.stringify(simulateSeries(0.6, 0.55)) === JSON.stringify(simulateSeries(0.6, 0.55)));

  // ---- History ----
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const games = await loadEloGames(client);
  const seasons = [...new Set(games.map((g) => g.season))].sort();
  console.log(`\nHistory loaded: ${games.length} games, ${seasons[0]}–${seasons.at(-1)} (${seasons.length} seasons).`);
  const era = (s: string) => eraOf(s).id;

  const a = runElo(games, p, era);
  const b = runElo([...games].reverse(), p, era);
  check("rebuild is deterministic (input order doesn't matter)", JSON.stringify(a.rows) === JSON.stringify(b.rows));

  // League mean within 5 of 1505 at every season's end (active teams).
  const bySeasonEnd = new Map<string, Map<number, number>>();
  const seasonOf = new Map(games.map((g) => [g.id, g.season]));
  for (const r of a.rows) {
    const s = seasonOf.get(r.gameId)!;
    if (!bySeasonEnd.has(s)) bySeasonEnd.set(s, new Map());
    bySeasonEnd.get(s)!.set(r.team, r.after);
  }
  const worst = [...bySeasonEnd].map(([s, m]) => ({ s, mean: [...m.values()].reduce((x, y) => x + y, 0) / m.size })).sort((x, y) => Math.abs(y.mean - 1505) - Math.abs(x.mean - 1505))[0];
  check("league mean stays within 5 of 1505 every season", Math.abs(worst.mean - 1505) <= 5, `${worst.s}: ${worst.mean.toFixed(1)}`);

  // The 1970-71 and 1971-72 Bruins near the top of franchise history by peak Elo.
  const bruinsPeaks = new Map<string, number>();
  for (const r of a.rows) if (r.team === 6) bruinsPeaks.set(seasonOf.get(r.gameId)!, Math.max(bruinsPeaks.get(seasonOf.get(r.gameId)!) ?? 0, r.after));
  const ranked = [...bruinsPeaks].sort((x, y) => y[1] - x[1]);
  if (bruinsPeaks.has("19711972")) {
    const rank = (s: string) => ranked.findIndex(([x]) => x === s) + 1;
    check("1970-71 and 1971-72 Bruins in the franchise's top 5 by peak Elo", rank("19701971") <= 5 && rank("19711972") <= 5, `ranks ${rank("19701971")} and ${rank("19711972")}; top 5: ${ranked.slice(0, 5).map(([s, r]) => `${s} ${r.toFixed(0)}`).join(", ")}`);
  } else {
    console.log("SKIP  1970s Bruins peak check (seasons not loaded yet)");
  }
  console.log(`Bruins top seasons by peak Elo so far: ${ranked.slice(0, 5).map(([s, r]) => `${s.slice(0, 4)}-${s.slice(6)} ${r.toFixed(0)}`).join(", ")}`);
  await client.end();

  console.log(`\n${failed === 0 ? "All passed." : `${failed} failed.`}`);
  process.exit(failed ? 1 : 0);
}

main();
