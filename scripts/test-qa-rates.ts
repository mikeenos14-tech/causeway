// The rate check in lib/qa-engine.ts (ungroundedRates): a percentage or
// rate in an answer must be in some query result. No model calls.
// Usage: npx tsx scripts/test-qa-rates.ts
import { ungroundedRates } from "../lib/qa-engine";

let failed = 0;
const q = (rows: Record<string, unknown>[]) => [{ rows }];
const cases: [string, string, ReturnType<typeof q>, string[]][] = [
  ["the published error: .726 when the query had W-L-OTL only", "Boston is 16-6-9 against Los Angeles, a .726 points percentage.", q([{ w: 16, l: 6, otl: 9 }]), [".726"]],
  ["the same rate from SQL passes", "Boston is 16-6-9, a .661 points percentage.", q([{ w: 16, pct: 0.6613 }]), []],
  ["numeric strings from Postgres count", "a .921 save percentage", q([{ sv: "0.92133" }]), []],
  ["a percentage stored as 66.1", "a 66.1% points percentage", q([{ pct: "66.13" }]), []],
  ["a percentage stored as a fraction", "converted 23.5% of power plays", q([{ pp: 0.2352 }]), []],
  ["an invented percentage", "they won 72% of those games", q([{ w: 16, gp: 31 }]), ["72%"]],
  ["'over .500' is a phrase", "Boston finished over .500 for the season, 44-30-8.", q([{ w: 44 }]), []],
  ["years and records aren't rates", "In 2010-11 Boston went 46-25-11 and won the Cup.", q([{ w: 46 }]), []],
  ["no queries at all", "a .726 points percentage", [], [".726"]],
];
for (const [name, text, queries, expect] of cases) {
  const got = ungroundedRates(text, queries);
  const ok = JSON.stringify(got) === JSON.stringify(expect);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — got ${JSON.stringify(got)}`}`);
}
console.log(`\n${failed === 0 ? "All passed." : `${failed} failed.`}`);
process.exit(failed ? 1 : 0);
