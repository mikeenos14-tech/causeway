import { NextResponse } from "next/server";
import { fetchLiveGame, LIVE_CACHE_SECONDS } from "@/lib/live-game";
import { getLiveWp } from "@/lib/live-wp";

// Polled by the live scoreboard every ~20s per open tab. The CDN cache
// header means every viewer shares one response per 5 seconds, so the NHL
// sees a handful of requests a minute no matter how many friends are on.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gameId = Number(id);
  if (!Number.isInteger(gameId) || gameId < 2000000000 || gameId > 2099999999) {
    return NextResponse.json({ error: "Bad game id." }, { status: 400 });
  }
  const game = await fetchLiveGame(gameId);
  if (!game) return NextResponse.json({ error: "Live data unavailable." }, { status: 502 });
  // Win probability rides along; if it fails or the database is slow (3s),
  // the scoreboard still goes out on time without it.
  const wp = await Promise.race([
    getLiveWp(game).catch((e) => {
      console.error("live wp", gameId, e);
      return null;
    }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
  ]);
  return NextResponse.json({ ...game, wp }, {
    headers: { "Cache-Control": `public, s-maxage=${LIVE_CACHE_SECONDS}, stale-while-revalidate=${LIVE_CACHE_SECONDS}` },
  });
}
