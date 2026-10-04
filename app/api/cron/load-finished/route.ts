import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { finishedGames, loadFinishedGame, needsLoad, pathsForGame, recentNhlDates, recordHeartbeat } from "@/lib/load-game";
import { pool } from "@/lib/db";

// Every 5 minutes (vercel.json): loads any finished game the site doesn't
// have yet, and re-reads games from the last 12 hours for the NHL's first
// corrections. The backstop for load-on-final (app/api/live/[id]), and the
// reason a dropped GitHub run no longer leaves results off the site.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  // Vercel sends the CRON_SECRET as a bearer token when one is set. Without
  // one, anyone can call this, so it runs at most once a minute (the work
  // is idempotent either way).
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  } else {
    const { rows } = await pool.query(`select at from ops_heartbeats where name = 'load-finished' and at > now() - interval '1 minute'`);
    if (rows.length) return NextResponse.json({ skipped: "ran under a minute ago" });
  }

  const results: string[] = [];
  let failures = 0;
  try {
    const games = await finishedGames(recentNhlDates());
    const todo = games.filter((g) => needsLoad(g)).slice(0, 20);
    for (const g of todo) {
      try {
        const r = await loadFinishedGame(g.id);
        results.push(`${g.id} ${r.status}${r.status === "skipped" ? ` (${r.reason})` : r.notes.length ? ` (${r.notes.join("; ")})` : ""}`);
        if (r.status !== "skipped") for (const path of pathsForGame(g.id, r.teams)) revalidatePath(path);
      } catch (e) {
        failures++;
        results.push(`${g.id} failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    const summary = `${games.length} final, ${todo.length} loaded or re-checked${results.length ? `: ${results.join(", ")}` : ""}`;
    await recordHeartbeat("load-finished", failures === 0, summary);
    return NextResponse.json({ ok: failures === 0, summary }, { status: failures ? 500 : 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordHeartbeat("load-finished", false, `failed: ${msg}`).catch(() => {});
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
