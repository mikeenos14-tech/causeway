// Phase 0 backfill, step 1 of 2: download the raw NHL feed for every
// regular-season and playoff game since 1917-18 into a local cache
// (data/raw/nhl/, gitignored). Two responses per game:
//   play-by-play  goals and penalties with times, shot events and on-ice
//                 counts where they exist, rosters, venue, shots on goal
//   landing       the scoring summary, whose strength flags (PP/SH) reach
//                 back decades further than play-by-play's on-ice counts
// Step 2 (load-nhl-history.ts) parses the cache into the database, so
// parsing can be fixed and re-run without touching the API again.
//
// Resumable: a game already in the cache is skipped, so re-running after
// a crash, a sleep, or a rate-limit storm picks up where it left off.
//
// Usage: npx tsx scripts/stats/fetch-nhl-history.ts [--from 19171918] [--to 20262027] [--limit N] [--kinds pbp,landing]
//   --kinds box   fetch boxscores instead (goalie per game: who played,
//                 started, decision), queued after the main backfill

import { mkdirSync, existsSync, writeFileSync, readFileSync, appendFileSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { join } from "node:path";
import { FETCH } from "../../config/stats";

const ROOT = join(import.meta.dirname, "..", "..", "data", "raw", "nhl");
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const FROM = arg("from") ?? "19171918";
const TO = arg("to") ?? "99999999";
const LIMIT = Number(arg("limit") ?? Infinity);
type Kind = "pbp" | "landing" | "box";
const KINDS = (arg("kinds") ?? "pbp,landing").split(",") as Kind[];
const ENDPOINT: Record<Kind, string> = { pbp: "play-by-play", landing: "landing", box: "boxscore" };

export type ListGame = {
  id: number;
  season: number;
  gameType: number;
  gameDate: string;
  easternStartTime: string;
  gameStateId: number;
  homeTeamId: number;
  visitingTeamId: number;
  homeScore: number;
  visitingScore: number;
  period: number;
};

export const cachePath = (season: string | number, id: number, kind: Kind) =>
  join(ROOT, String(season), `${id}.${kind}.json.gz`);

// One global pacing clock shared by every worker.
let nextSlot = 0;
async function pace() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + FETCH.minIntervalMs;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

export async function fetchText(url: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    await pace();
    try {
      const res = await fetch(url, { headers: { "User-Agent": "causeway-backfill/1.0" } });
      if (res.ok) return await res.text();
      if (res.status !== 429 && res.status < 500) throw new Error(`HTTP ${res.status} for ${url}`);
      if (attempt >= FETCH.maxRetries) throw new Error(`HTTP ${res.status} after ${attempt} retries: ${url}`);
    } catch (err) {
      if (attempt >= FETCH.maxRetries || (err instanceof Error && /HTTP 4\d\d for/.test(err.message))) throw err;
    }
    const wait = FETCH.backoffMs[Math.min(attempt, FETCH.backoffMs.length - 1)];
    // Back everyone off, not just this worker: a 429 is about our total rate.
    nextSlot = Math.max(nextSlot, Date.now() + wait);
  }
}

export async function loadGameList(): Promise<ListGame[]> {
  mkdirSync(ROOT, { recursive: true });
  const listFile = join(ROOT, "games-list.json");
  // Refreshed every run: it's one request, and the current season grows.
  const text = await fetchText("https://api.nhle.com/stats/rest/en/game?cayenneExp=gameType%20in%20(2,3)");
  writeFileSync(listFile, text);
  return (JSON.parse(text).data as ListGame[]).filter((g) => g.gameStateId === 7 || g.gameStateId === 6);
}

async function main() {
  const all = await loadGameList();
  const games = all
    .filter((g) => String(g.season) >= FROM && String(g.season) <= TO)
    .sort((a, b) => a.id - b.id)
    .filter((g) => KINDS.some((k) => !existsSync(cachePath(g.season, g.id, k))))
    .slice(0, LIMIT);
  console.log(`${all.length} completed games in the NHL list; ${games.length} still to fetch (${FROM}-${TO}).`);

  const failLog = join(ROOT, "fetch-failures.log");
  let done = 0;
  let failed = 0;
  const started = Date.now();
  let cursor = 0;

  async function worker() {
    while (cursor < games.length) {
      const g = games[cursor++];
      try {
        mkdirSync(join(ROOT, String(g.season)), { recursive: true });
        for (const kind of KINDS) {
          const path = cachePath(g.season, g.id, kind);
          if (existsSync(path)) continue;
          const url = `https://api-web.nhle.com/v1/gamecenter/${g.id}/${ENDPOINT[kind]}`;
          let text: string;
          try {
            text = await fetchText(url);
            JSON.parse(text); // never cache a truncated or HTML error body
          } catch (err) {
            // A real 404 is permanent (some old games have no summary);
            // record it so re-runs don't retry it forever.
            if (!(err instanceof Error && /HTTP 404 for/.test(err.message))) throw err;
            text = JSON.stringify({ _missing: 404 });
          }
          writeFileSync(path, gzipSync(text));
        }
      } catch (err) {
        failed++;
        appendFileSync(failLog, `${new Date().toISOString()} ${g.id} ${err instanceof Error ? err.message : err}\n`);
      }
      done++;
      if (done % 250 === 0 || done === games.length) {
        const rate = done / ((Date.now() - started) / 1000);
        const etaMin = Math.round((games.length - done) / rate / 60);
        console.log(`${done}/${games.length} games (${failed} failed) · ${rate.toFixed(2)} games/s · ~${etaMin} min left · at ${g.season}`);
      }
    }
  }
  await Promise.all(Array.from({ length: FETCH.concurrency }, worker));
  console.log(`Done. ${done - failed} fetched, ${failed} failed${failed ? ` (see ${failLog}; re-run to retry)` : ""}.`);
}

// Only when run directly (the loader imports cachePath/loadGameList).
if (process.argv[1]?.endsWith("fetch-nhl-history.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export function readCached(season: string | number, id: number, kind: Kind): unknown | null {
  const path = cachePath(season, id, kind);
  if (!existsSync(path)) return null;
  const data = JSON.parse(gunzipSync(readFileSync(path)).toString());
  return data && data._missing ? null : data;
}
