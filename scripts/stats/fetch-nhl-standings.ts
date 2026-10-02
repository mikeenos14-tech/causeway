// Fetches league standings as of every regular-season game date since
// 1917-18 into the local cache (data/raw/nhl/standings/<date>.json.gz).
// Grudge needs each season's divisions; Misery needs the playoff race late
// in a season and each team's seeding. Resumable like the game backfill.
//
// Usage: npx tsx scripts/stats/fetch-nhl-standings.ts

import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { fetchText, type ListGame } from "./fetch-nhl-history";

const ROOT = join(import.meta.dirname, "..", "..", "data", "raw", "nhl");
export const standingsPath = (date: string) => join(ROOT, "standings", `${date}.json.gz`);

async function main() {
  mkdirSync(join(ROOT, "standings"), { recursive: true });
  const list: ListGame[] = JSON.parse(readFileSync(join(ROOT, "games-list.json"), "utf8")).data;
  const dates = [...new Set(list.filter((g) => g.gameType === 2 && (g.gameStateId === 7 || g.gameStateId === 6)).map((g) => g.gameDate))].sort();
  const todo = dates.filter((d) => !existsSync(standingsPath(d)));
  console.log(`${dates.length} regular-season game dates; ${todo.length} still to fetch.`);
  let done = 0;
  for (const d of todo) {
    try {
      const text = await fetchText(`https://api-web.nhle.com/v1/standings/${d}`);
      JSON.parse(text);
      writeFileSync(standingsPath(d), gzipSync(text));
    } catch (err) {
      console.error(`${d}: ${err instanceof Error ? err.message : err}`);
    }
    if (++done % 500 === 0) console.log(`${done}/${todo.length} dates (at ${d})`);
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
