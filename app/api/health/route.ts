import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { fetchLiveGame } from "@/lib/live-game";
import { finishedGames, recentNhlDates } from "@/lib/load-game";

// One URL an uptime monitor checks every few minutes: 200 when the site is
// healthy, 503 (with what's wrong) when it isn't, so a problem pages the
// owner instead of being found by accident.
//   - the database answers
//   - every game the NHL has made official is on the site (3 h after puck drop)
//   - live scores come through for a game in progress
//   - the site's 5-minute loader and the hourly GitHub refresh are running
//   - the database isn't growing out of control
export const dynamic = "force-dynamic";

// Neon's paid plan (2026-10-05) has no practical cap; this alarm now
// catches runaway growth (storage is billed per GB). The database was
// about 930 MB then.
const STORAGE_LIMIT_MB = Number(process.env.DB_STORAGE_LIMIT_MB ?? 5000);

export async function GET() {
  const problems: string[] = [];
  const info: Record<string, unknown> = {};
  const t0 = Date.now();
  try {
    const { rows: [db] } = await pool.query(`select pg_database_size(current_database()) as bytes`);
    info.dbMs = Date.now() - t0;
    const mb = Math.round(Number(db.bytes) / 1048576);
    info.dbMb = mb;
    if (mb > STORAGE_LIMIT_MB * 0.95) problems.push(`database at ${mb} MB of ${STORAGE_LIMIT_MB} MB`);

    const { rows: beats } = await pool.query(`select name, at, ok, detail from ops_heartbeats`);
    const beat = new Map(beats.map((b) => [b.name, b]));
    const age = (name: string) => (beat.has(name) ? (Date.now() - new Date(beat.get(name).at).getTime()) / 60_000 : null);
    const loader = age("load-finished");
    info.loaderMinutesAgo = loader === null ? null : Math.round(loader);
    // Checked once the 5-minute cron is set up (CRON_SECRET goes in with it,
    // on Vercel Pro); until then the loader only runs on final whistles.
    if (process.env.CRON_SECRET && loader !== null && loader > 20) problems.push(`the 5-minute game loader last ran ${Math.round(loader)} min ago`);
    if (beat.get("load-finished")?.ok === false) problems.push(`the game loader's last run failed: ${beat.get("load-finished").detail}`);
    const hourly = age("hourly-refresh");
    info.hourlyMinutesAgo = hourly === null ? null : Math.round(hourly);
    if (hourly !== null && hourly > 180) problems.push(`the hourly GitHub refresh last ran ${Math.round(hourly / 60)} h ago`);
  } catch (e) {
    problems.push(`database: ${e instanceof Error ? e.message : e}`);
  }

  try {
    const missing = (await finishedGames(recentNhlDates())).filter((g) => !g.loadedAt && Date.now() - Date.parse(g.start) > 3 * 3600_000);
    if (missing.length) problems.push(`finished games not on the site: ${missing.map((g) => g.id).join(", ")}`);
    const now = await (await fetch("https://api-web.nhle.com/v1/score/now", { cache: "no-store", signal: AbortSignal.timeout(8000) })).json();
    const live = (now.games ?? []).find((g: { gameState: string }) => g.gameState === "LIVE" || g.gameState === "CRIT");
    if (live) {
      const game = await fetchLiveGame(live.id);
      info.liveCheck = game ? `${live.id} ok` : `${live.id} failed`;
      if (!game) problems.push(`live scores unavailable for game ${live.id}`);
    }
  } catch (e) {
    problems.push(`NHL feed: ${e instanceof Error ? e.message : e}`);
  }

  return NextResponse.json(
    { ok: problems.length === 0, problems, ...info, checkedAt: new Date().toISOString() },
    // Shared for 30 s so hammering this URL can't hammer the database or the NHL.
    { status: problems.length ? 503 : 200, headers: { "Cache-Control": "public, s-maxage=30" } },
  );
}
