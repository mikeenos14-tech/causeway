import { NextResponse } from "next/server";
import { fetchLiveGame, LIVE_CACHE_SECONDS } from "@/lib/live-game";
import { getLiveWp } from "@/lib/live-wp";
import { playersWithPages } from "@/lib/leverage-data";

// Polled by the live scoreboard every 5 s during a game. The CDN cache
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
  return NextResponse.json({ ...game, wp }, {
    headers: { "Cache-Control": `public, s-maxage=${LIVE_CACHE_SECONDS}, stale-while-revalidate=${LIVE_CACHE_SECONDS}` },
  });
}
