// Header search tests (lib/search.ts) against the real index, served by a
// running dev server: what a fan types, and what must come up first.
//
// Usage: npx tsx scripts/test-search.ts [http://localhost:3977]

import { search, normalize } from "../lib/search";
import type { SearchIndex } from "../app/api/search-index/route";

const base = process.argv[2] ?? "http://localhost:3977";
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
};

async function main() {
  check("accents are stripped", normalize("Lafrenière") === "lafreniere" && normalize("Montréal") === "montreal");
  const t0 = performance.now();
  const index: SearchIndex = await (await fetch(`${base}/api/search-index`)).json();
  console.log(`index: ${index.players.length} players, ${index.teams.length} teams (${Math.round(performance.now() - t0)} ms to fetch)`);
  const first = (q: string) => search(index, q)[0]?.title ?? "(nothing)";
  const cases: [string, string][] = [
    ["pastr", "David Pastrnak"],
    ["Pastrnak", "David Pastrnak"],
    ["marchand", "Brad Marchand"],
    ["bergeron", "Patrice Bergeron"],
    ["lafreniere", "Alexis Lafrenière"],
    ["swayman", "Jeremy Swayman"],
    ["tuukka", "Tuukka Rask"],
    ["bruins", "Boston Bruins"],
    ["rangers", "New York Rangers"],
    ["NYR", "New York Rangers"],
    ["montreal", "Montréal Canadiens"],
    ["berg", "Patrice Bergeron"],
  ];
  for (const [q, want] of cases) check(`"${q}" finds ${want} first`, first(q) === want, `got ${first(q)}`);
  const lind = search(index, "lindholm").slice(0, 2).map((h) => h.title).sort();
  check("both Bruins Lindholms come before any other Lindholm", JSON.stringify(lind) === JSON.stringify(["Elias Lindholm", "Hampus Lindholm"]), lind.join(", "));
  check("one letter shows nothing (too broad)", search(index, "a").length === 0);
  check("nonsense shows nothing", search(index, "zzqx").length === 0);
  check("at most 8 results", search(index, "an").length <= 8);
  const p = search(index, "pastrnak")[0];
  check("player detail reads position, team and latest season", p?.detail === "RW · BOS · 2026-27", p?.detail);
  const b = search(index, "bergeron")[0];
  check("a retired Bruin shows his last season, not a misleading span", b?.detail === "C · BOS · 2022-23", b?.detail);
  const t1 = performance.now();
  for (let i = 0; i < 200; i++) search(index, "mar");
  const per = (performance.now() - t1) / 200;
  check(`a keystroke's search takes under 5 ms (${per.toFixed(2)} ms)`, per < 5);
  console.log(`\n${failed === 0 ? "All passed." : `${failed} failed.`}`);
  process.exit(failed ? 1 : 0);
}
main();
