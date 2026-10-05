// Every game's chances since 2009-10 (game_chances, lib/xg.ts), from the
// cached play-by-play (data/raw/nhl) or, for a game the cache doesn't
// have, the NHL's feed.
//
// Usage: npx tsx --env-file=.env.local scripts/stats/build-game-chances.ts [--recent]
//   --recent: only games without a row, or from the last 48 hours (hourly)

import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { Client } from "pg";
import { gameChances, saveGameChances, shotsFromPlayByPlay, XG_FIRST_SEASON, XG_MODEL_VERSION } from "../../lib/xg";

/* eslint-disable @typescript-eslint/no-explicit-any -- the NHL feed is untyped JSON */
async function playByPlay(id: number, season: string): Promise<any> {
  const f = path.join("data/raw/nhl", season, `${id}.pbp.json.gz`);
  // The cache is only trusted for finished games older than two days (the
  // NHL corrects play-by-play after a game, as it does box scores).
  if (existsSync(f)) {
    const pbp = JSON.parse(gunzipSync(readFileSync(f)).toString());
    if (pbp.gameState === "OFF") return pbp;
  }
  for (let i = 0; i < 6; i++) {
    const res = await fetch(`https://api-web.nhle.com/v1/gamecenter/${id}/play-by-play`).catch(() => null);
    if (res?.ok) return res.json();
    await new Promise((r) => setTimeout(r, 1500 * 2 ** i));
  }
  throw new Error(`play-by-play ${id} unavailable`);
}

(async () => {
  const recent = process.argv.includes("--recent");
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const { rows } = await db.query(
    `select g.id, g.season_id as season, g.game_date >= current_date - 2 as fresh from games g
     left join game_chances c on c.game_id = g.id
     where g.season_id >= $1 and g.game_type in ('regular', 'playoff')
       and ($2::boolean is false or c.game_id is null or g.game_date >= current_date - 2 or c.model_version <> $3)
     order by g.id`,
    [XG_FIRST_SEASON, recent, XG_MODEL_VERSION],
  );
  let done = 0, skipped = 0;
  for (const g of rows) {
    const pbp = await playByPlay(g.id, g.season);
    const shots = shotsFromPlayByPlay(pbp);
    if (!shots || !shots.length) {
      skipped++;
      continue;
    }
    await saveGameChances(db, g.id, gameChances(shots));
    if (++done % 1000 === 0) console.log(`  ${done}/${rows.length}`);
  }
  console.log(`Chances stored for ${done} games${skipped ? `; ${skipped} had no shot data` : ""}.`);
  await db.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
