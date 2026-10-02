// Fetches the NHL's per-player game logs for every player-season in
// nhl_skater_games (games before 2007-08), into a local cache. Old
// boxscores list players who didn't play (all zeros, no ice time recorded):
// Garnet Bailey has 62 box rows in 1970-71 but played 36 games. The game
// log is the NHL's record of which games a player actually played; the
// loader (load-nhl-appearances.ts) marks each box row played or not.
//
// Resumable: a cached log is skipped. Paced (one global clock) with
// backoff on 429/5xx.
//
// Usage: npx tsx --env-file=.env.local scripts/stats/fetch-nhl-gamelogs.ts

import { Client } from "pg";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

export const LOG_ROOT = join(import.meta.dirname, "..", "..", "data", "raw", "nhl-gamelogs");
export const logPath = (season: string, playerId: number, type: 2 | 3) => join(LOG_ROOT, season, `${playerId}.${type}.json.gz`);
const RATE_PER_SEC = 6;
const WORKERS = 6;

let nextSlot = 0;
async function pace() {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + 1000 / RATE_PER_SEC;
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
}

async function fetchLog(season: string, playerId: number, type: 2 | 3): Promise<"ok" | "failed"> {
  const path = logPath(season, playerId, type);
  if (existsSync(path)) return "ok";
  for (let attempt = 0; attempt < 6; attempt++) {
    await pace();
    try {
      const res = await fetch(`https://api-web.nhle.com/v1/player/${playerId}/game-log/${season}/${type}`, { headers: { "User-Agent": "causeway/1.0" } });
      if (res.ok) {
        const data = await res.json();
        mkdirSync(join(LOG_ROOT, season), { recursive: true });
        // Only what the loader needs: the game ids he played.
        writeFileSync(path, gzipSync(JSON.stringify({ games: (data.gameLog ?? []).map((g: { gameId: number }) => g.gameId) })));
        return "ok";
      }
      if (res.status === 404) {
        mkdirSync(join(LOG_ROOT, season), { recursive: true });
        writeFileSync(path, gzipSync(JSON.stringify({ games: [], missing: true })));
        return "ok";
      }
    } catch {
      // network error: retry
    }
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  return "failed";
}

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const { rows } = await db.query(
    `select s.player_id, g.season, bool_or(g.game_type = 'playoff') as playoffs
     from nhl_skater_games s join nhl_games g on g.id = s.game_id group by 1, 2 order by 2, 1`,
  );
  await db.end();
  const jobs = rows.flatMap((r) => [
    { season: r.season as string, id: Number(r.player_id), type: 2 as const },
    ...(r.playoffs ? [{ season: r.season as string, id: Number(r.player_id), type: 3 as const }] : []),
  ]);
  const todo = jobs.filter((j) => !existsSync(logPath(j.season, j.id, j.type)));
  console.log(`${jobs.length} game logs, ${todo.length} to fetch.`);
  let done = 0, failed = 0, i = 0;
  const start = Date.now();
  await Promise.all(
    Array.from({ length: WORKERS }, async () => {
      while (i < todo.length) {
        const j = todo[i++];
        if ((await fetchLog(j.season, j.id, j.type)) === "failed") failed++;
        if (++done % 1000 === 0) {
          const rate = done / ((Date.now() - start) / 1000);
          console.log(`${done}/${todo.length} (${failed} failed) · ${rate.toFixed(1)}/s · ~${Math.round((todo.length - done) / rate / 60)} min left`);
        }
      }
    }),
  );
  console.log(`Done: ${done} fetched, ${failed} failed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
