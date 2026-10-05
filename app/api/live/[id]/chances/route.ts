import { NextResponse } from "next/server";
import { gameChances, shotsFromPlayByPlay } from "@/lib/xg";

// A game's chances so far (expected goals, by period, shot attempts) from
// the NHL's play-by-play. Polled every 15 s by the live scoreboard: chances
// change a shot at a time, and the play-by-play is far heavier than the
// score feed, so the edge shares one response for 15 s.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gameId = Number((await params).id);
  if (!Number.isInteger(gameId) || gameId < 2009000000 || gameId > 2099999999) return NextResponse.json({ error: "Bad game id." }, { status: 400 });
  try {
    const res = await fetch(`https://api-web.nhle.com/v1/gamecenter/${gameId}/play-by-play`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return NextResponse.json({ error: "Play-by-play unavailable." }, { status: 502 });
    const pbp = await res.json();
    const shots = shotsFromPlayByPlay(pbp);
    if (!shots) return NextResponse.json({ error: "No shot data for this season." }, { status: 404 });
    return NextResponse.json({ state: pbp.gameState, ...gameChances(shots) }, { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=15" } });
  } catch {
    return NextResponse.json({ error: "Play-by-play unavailable." }, { status: 502 });
  }
}
