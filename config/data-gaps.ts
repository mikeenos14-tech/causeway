// Players whose career here can't match the NHL's official totals because
// the NHL's own records disagree with each other (checked 2026-10-03 and
// 2026-10-11 against its per-game logs). Shown as a note on the player's
// page, and expected by scripts/qa/check-player-careers.ts.
export const PLAYER_DATA_GAPS: Record<number, string> = {
  8452477:
    "The NHL has no game-by-game record of Rick Wilson's 1973-74 and 1975-76 seasons, so those seasons and his career totals here are incomplete. His official NHL career: 239 games, 6 goals, 26 assists.",
  8448197: "The NHL's official totals credit Joe Primeau with 310 regular-season games; its game-by-game records list 309, which is what's shown here.",
  8447591: "The NHL's official totals credit Chico Maki with 113 playoff games; its game-by-game records list 112, which is what's shown here.",
};
