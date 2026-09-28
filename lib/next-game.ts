// A short contextual line for the next game — the same "carry real
// structure, not fabricated specifics" pattern as the homepage's win-streak
// "stop us" aside: only fires when it's actually true of this specific
// matchup, never a fixed phrase copied in regardless of who's next.
//
// The game itself now comes from lib/nhl-schedule.ts (the full live season
// schedule), which replaced the old week-only fetch that lived here.

import type { ClubGame } from "./nhl-schedule";

const ORIGINAL_SIX = new Set(["CHI", "DET", "MTL", "NYR", "TOR", "BOS"]);
// Not exhaustive across every realignment in league history — this is
// just for a homepage flavor line, not a stats claim, so the current
// Atlantic lineup is enough.
const ATLANTIC_RIVALS = new Set(["TOR", "MTL", "TBL", "FLA", "OTT", "DET", "BUF"]);

// The rivalry lines are written from Boston's side, so they only appear on
// Boston's page; the playoff line is true for anyone.
export function nextGameFlavor(game: Pick<ClubGame, "gameType" | "opponent">, teamAbbrev: string): string | null {
  if (game.gameType === 3) return "No such thing as an ordinary shift anymore.";
  if (teamAbbrev !== "BOS") return null;
  if (ORIGINAL_SIX.has(game.opponent)) return "Original Six. Bring the antacids.";
  if (ATLANTIC_RIVALS.has(game.opponent)) return "Division game — these always matter more than they should.";
  return null;
}
