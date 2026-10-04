// Games the NHL has under way or not yet official right now. The data
// checks compare our totals with the NHL's, which a game in progress (or
// one just ended and not yet loaded) makes differ for no real reason.
/* eslint-disable @typescript-eslint/no-explicit-any -- the NHL feed is untyped JSON */
export async function gamesInProgress(): Promise<string[]> {
  const res = await fetch("https://api-web.nhle.com/v1/score/now");
  if (!res.ok) throw new Error(`NHL score feed: ${res.status}`);
  const day = await res.json();
  return (day.games ?? [])
    .filter((g: any) => ["LIVE", "CRIT", "OVER", "FINAL"].includes(g.gameState))
    .map((g: any) => `${g.awayTeam.abbrev}@${g.homeTeam.abbrev} (${g.gameState})`);
}
