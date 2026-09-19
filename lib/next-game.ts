// Live "next game" data for the homepage — unlike everything else on the
// site, this isn't backfilled into our own database (the backfill only
// ever loads completed games, by design — see scripts/backfill-season.ts).
// A future game is inherently a "right now" fact, so it's fetched fresh
// from the NHL API on each request rather than stored, the same way the
// NHL's own apps do it.

const API = "https://api-web.nhle.com/v1";

const ORIGINAL_SIX = new Set(["CHI", "DET", "MTL", "NYR", "TOR", "BOS"]);
// Not exhaustive across every realignment in league history — this is
// just for a homepage flavor line, not a stats claim, so the current
// Atlantic lineup is enough.
const ATLANTIC_RIVALS = new Set(["TOR", "MTL", "TBL", "FLA", "OTT", "DET", "BUF"]);

export type NextGame = {
  id: number;
  gameDate: string;
  gameType: number;
  opponent: string;
  isHome: boolean;
  venue: string;
};

export async function getNextGame(teamAbbrev: string): Promise<NextGame | null> {
  try {
    const res = await fetch(`${API}/club-schedule/${teamAbbrev}/week/now`, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const data = await res.json();
    const next = (data.games ?? []).find((g: { gameState: string }) => g.gameState === "FUT");
    if (!next) return null;
    const isHome = next.homeTeam.abbrev === teamAbbrev;
    return {
      id: next.id,
      gameDate: next.gameDate,
      gameType: next.gameType,
      opponent: isHome ? next.awayTeam.abbrev : next.homeTeam.abbrev,
      isHome,
      venue: next.venue?.default ?? "",
    };
  } catch (err) {
    console.error("getNextGame failed (non-fatal — homepage just omits the card):", err);
    return null;
  }
}

// A short contextual line, the same "carry real structure, not fabricated
// specifics" pattern as the homepage's win-streak "stop us" aside — only
// fires when it's actually true of this specific matchup, never a fixed
// phrase copied in regardless of who's actually next.
export function nextGameFlavor(game: NextGame): string | null {
  // The game-type badge (Preseason/Playoff) already says what kind of game
  // this is — these lines add the reaction to it, not a restatement of it.
  if (game.gameType === 1) return "The games that don't count and somehow still make you nervous.";
  if (game.gameType === 3) return "No such thing as an ordinary shift anymore.";
  if (game.opponent !== "BOS" && ORIGINAL_SIX.has(game.opponent)) return "Original Six. Bring the antacids.";
  if (ATLANTIC_RIVALS.has(game.opponent)) return "Division game — these always matter more than they should.";
  return null;
}
