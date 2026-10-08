// Games the NHL has under way or not yet official right now. The data
// checks compare our totals with the NHL's, which a game in progress (or
// one just ended and not yet loaded) makes differ for no real reason.
//
// The NHL rate-limits GitHub's shared runners; a single refused request
// once crashed the morning's career check before it compared anything
// (2026-10-07). So: retry with backoff, and if the NHL still won't say,
// report none and let the check run (its own NHL calls retry too).
/* eslint-disable @typescript-eslint/no-explicit-any -- the NHL feed is untyped JSON */
async function scoreNow(): Promise<any[] | null> {
  for (let i = 0; i < 5; i++) {
    const res = await fetch("https://api-web.nhle.com/v1/score/now").catch(() => null);
    if (res?.ok) return (await res.json()).games ?? [];
    await new Promise((r) => setTimeout(r, 3000 * 2 ** i));
  }
  console.warn("Couldn't reach the NHL's score feed to check for games in progress; running the check anyway.");
  return null;
}
const unofficial = (g: any) => ["LIVE", "CRIT", "OVER", "FINAL"].includes(g.gameState);

export async function gamesInProgress(): Promise<string[]> {
  return ((await scoreNow()) ?? []).filter(unofficial).map((g) => `${g.awayTeam.abbrev}@${g.homeTeam.abbrev} (${g.gameState})`);
}

// The teams in those games (a game is official once the NHL marks it OFF).
export async function teamsInUnofficialGames(): Promise<Set<string>> {
  const out = new Set<string>();
  for (const g of ((await scoreNow()) ?? []).filter(unofficial)) {
    out.add(g.awayTeam.abbrev);
    out.add(g.homeTeam.abbrev);
  }
  return out;
}
