import { NextResponse, after } from "next/server";
import { revalidatePath } from "next/cache";
import { fetchLiveGame, LIVE_CACHE_SECONDS } from "@/lib/live-game";
import { loadFinishedGame, pathsForGame } from "@/lib/load-game";
import { pool } from "@/lib/db";
import { getLiveWp } from "@/lib/live-wp";
import { playersWithPages } from "@/lib/leverage-data";

// Polled by the live scoreboard every 2 s during a game. The CDN cache
// header means every viewer shares one response a second, so the NHL sees
// about one request a second per game no matter how many people are on.
export const maxDuration = 60;

// Load-on-final: the first time this endpoint sees a game final that the
// site doesn't have, it loads it (after the response goes out), so the
// result, box score and standings are on the site within seconds of the
// horn. /api/cron/load-finished is the backstop. Remembered per server
// instance so a final game's polls don't each check the database.
const handled = new Set<number>();
async function loadOnFinal(gameId: number) {
  if (handled.has(gameId)) return;
  handled.add(gameId);
  try {
    const { rowCount } = await pool.query(`select 1 from games where id = $1`, [gameId]);
    if (rowCount) return;
    const r = await loadFinishedGame(gameId);
    console.log("load-on-final", gameId, r.status, r.status === "skipped" ? r.reason : r.notes.join("; "));
    if (r.status === "skipped") {
      if (r.reason === "another load is running") return;
      handled.delete(gameId); // e.g. not final in the box score yet: try again on a later poll
      return;
    }
    for (const path of pathsForGame(gameId, r.teams)) revalidatePath(path);
  } catch (e) {
    handled.delete(gameId);
    console.error("load-on-final failed", gameId, e);
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gameId = Number(id);
  if (!Number.isInteger(gameId) || gameId < 2000000000 || gameId > 2099999999) {
    return NextResponse.json({ error: "Bad game id." }, { status: 400 });
  }
  const game = await fetchLiveGame(gameId);
  if (!game) return NextResponse.json({ error: "Live data unavailable." }, { status: 502 });
  // Win probability, and which goal scorers and assisters have a page,
  // ride along; if either fails or the database is slow (3s), the
  // scoreboard still goes out on time without it.
  const slow = <T,>(p: Promise<T>, fallback: T) =>
    Promise.race([
      p.catch((e) => {
        console.error("live extras", gameId, e);
        return fallback;
      }),
      new Promise<T>((resolve) => setTimeout(() => resolve(fallback), 3000)),
    ]);
  const ids = game.goals.flatMap((g) => [g.scorerId, ...g.assistIds]);
  const [wp, pages] = await Promise.all([
    slow(getLiveWp(game), null),
    ids.some((x) => x != null) ? slow(playersWithPages(ids), new Set<number>()) : Promise.resolve(new Set<number>()),
  ]);
  game.playersWithPages = [...pages];
  if (game.state === "FINAL" || game.state === "OFF") after(() => loadOnFinal(gameId));
  return NextResponse.json({ ...game, wp }, {
    headers: { "Cache-Control": `public, s-maxage=${LIVE_CACHE_SECONDS}, stale-while-revalidate=${LIVE_CACHE_SECONDS}` },
  });
}
