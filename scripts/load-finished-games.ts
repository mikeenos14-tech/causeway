// Loads every finished game the site doesn't have yet (the same work as
// /api/cron/load-finished). Runs before the daily data checks: GitHub
// started the 10 AM job six hours late on 2026-10-04, after an afternoon
// game had ended but before anything loaded it, and every check compared
// the NHL's totals (with that game) to ours (without it).
//
// Usage: npx tsx --env-file=.env.local scripts/load-finished-games.ts
import { pool } from "../lib/db";
import { finishedGames, loadFinishedGame, recentNhlDates } from "../lib/load-game";

(async () => {
  const missing = (await finishedGames(recentNhlDates())).filter((g) => !g.loadedAt);
  for (const g of missing) {
    const r = await loadFinishedGame(g.id);
    console.log(g.id, r.status, r.status === "skipped" ? r.reason : r.notes.join("; "));
  }
  console.log(`${missing.length} finished games were missing and are now loaded.`);
  await pool.end();
})();
