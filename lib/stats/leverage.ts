// Leverage Goals (spec section 8): pure functions, unit-tested in
// scripts/stats/test-leverage.ts and shared by the build and the pages.
//
// A goal's WPA is what it did to the scoring team's chance of winning (its
// expected result: win plus half a tie, in eras with ties), from just
// before to just after, at the same moment. In the playoffs a game's
// stakes are how much winning it instead of losing it moves the chance of
// winning the series; playoff leverage is WPA times stakes.

import { ELO } from "../../config/stats";
import type { WpGameContext } from "../wp-curve";

export const GARBAGE_WPA = 0.02; // a goal that moved its team's chance less than 2 points
export const ASSIST_SHARE = { primary: 0.5, secondary: 0.25 }; // additive; the scorer keeps full credit (a convention, not fitted)

// Chance team A wins a single game against B on neutral ice, from Elo (the
// pregame odds' slope without home ice; a back-to-back isn't known for
// future games).
export function neutralGameChance(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.exp(-ELO.winProb.slope * (ratingA - ratingB)));
}

// P(A wins a series it needs `need` wins of, from aWins - bWins, each game
// won with chance p).
export function seriesChance(aWins: number, bWins: number, need: number, p: number): number {
  const memo = new Map<string, number>();
  const go = (a: number, b: number): number => {
    if (a >= need) return 1;
    if (b >= need) return 0;
    const k = `${a},${b}`;
    let v = memo.get(k);
    if (v === undefined) {
      v = p * go(a + 1, b) + (1 - p) * go(a, b + 1);
      memo.set(k, v);
    }
    return v;
  };
  return go(aWins, bWins);
}

// Stakes of the next game: P(series | win it) - P(series | lose it). Game 7
// is 1; Game 1 of an even best-of-seven is about 0.31. Same for both teams.
export function gameStakes(aWins: number, bWins: number, need: number, p: number): number {
  return seriesChance(aWins + 1, bWins, need, p) - seriesChance(aWins, bWins + 1, need, p);
}

export type SeriesGame = { id: number; teamA: number; aScore: number; bScore: number }; // scores from team A's side
export type SeriesFormat = { kind: "best-of"; need: number } | { kind: "total-goals" } | { kind: "irregular" };

// The format from the series as played. Two-game series before 1937-38 were
// decided on total goals (game 2 was played whatever game 1's result),
// where a game's "win" has no stakes, except the 1929 and 1930 Stanley
// Cup Finals, best-of-three series that ended 2-0. A longer series with a
// tie (the 1927 Final ended 2 wins and 2 ties under time-limited
// overtime) can't be read as best-of-N. Otherwise best-of-N, the wins
// needed read off the winner, who must have won the last game; anything
// else is irregular and gets no stakes rather than a guess.
const BEST_OF_THREE_FINALS = new Set(["19281929", "19291930"]);

export function seriesFormat(season: string, games: SeriesGame[], isFinal = false): SeriesFormat {
  const ties = games.filter((g) => g.aScore === g.bScore).length;
  if (season < "19371938" && games.length === 2 && !(isFinal && BEST_OF_THREE_FINALS.has(season))) return { kind: "total-goals" };
  if (ties > 0) return { kind: "irregular" };
  const aWins = games.filter((g) => g.aScore > g.bScore).length;
  const bWins = games.length - aWins;
  if (aWins === bWins) return { kind: "irregular" };
  const last = games.at(-1)!;
  const winnerA = aWins > bWins;
  if (winnerA !== last.aScore > last.bScore) return { kind: "irregular" };
  return { kind: "best-of", need: Math.max(aWins, bWins) };
}

export const formatLabel = (f: SeriesFormat) => (f.kind === "best-of" ? `best-of-${2 * f.need - 1}` : f.kind);

// Every goal's before/after chance (scoring team's side) and the game's
// reconciliation from the home side: pregame + goal WPA + clock drift =
// final. `ctx.at` is the home side's expected result at a moment.
export type GoalIn = { eventId: number; t: number; home: boolean };
export type GoalWpa = { eventId: number; before: number; after: number; wpa: number };

export function gameLeverage(ctx: WpGameContext, goals: GoalIn[], end: number, final: number): { pregame: number; final: number; goals: GoalWpa[]; goalWpaHome: number; drift: number } {
  const pregame = ctx.at(0, 0, 0);
  let h = 0, a = 0, goalWpaHome = 0, drift = 0, segStart = pregame;
  const out: GoalWpa[] = [];
  for (const g of [...goals].sort((x, y) => x.t - y.t)) {
    // The clock's share: from the last goal (or puck drop) to this one.
    const before = ctx.at(g.t, h, a);
    drift += before - segStart;
    if (g.home) h++;
    else a++;
    const after = ctx.at(g.t, h, a);
    goalWpaHome += after - before;
    const b = g.home ? before : 1 - before, f = g.home ? after : 1 - after;
    out.push({ eventId: g.eventId, before: b, after: f, wpa: f - b });
    segStart = after;
  }
  // The rest of the clock, then the result itself (a shootout, or a lead
  // at the horn becoming a win, which the model already has at 100%).
  drift += ctx.at(end, h, a) - segStart + (final - ctx.at(end, h, a));
  return { pregame, final, goals: out, goalWpaHome, drift };
}

// Cup Leverage (spec section 8, V2): a playoff goal's leverage times how
// much winning its series would move the team's chance of winning the Cup.
// The later-round opponents are the teams that actually played those
// rounds (an owner decision, 2026-10-02: simple and explainable, though it
// uses hindsight about who came through the other side of the bracket).

export type BracketSeries = { teams: [number, number]; winner: number; format: SeriesFormat; isFinal: boolean };

// A whole series' chance from a single game's p. Two-game total-goals and
// irregular series are treated as one game (no better rule exists).
export function seriesWinChance(format: SeriesFormat, p: number): number {
  return format.kind === "best-of" ? seriesChance(0, 0, format.need, p) : p;
}

// P(team wins the Cup | it wins bracket[from]), following the actual
// bracket: the slot it would move into is the one its series' real winner
// moved into, and the opponent there is whoever actually played it. Null
// if the bracket can't be followed to the Final (or a rating is missing).
// `bracket` is the season's series in order (round, then series number).
export function cupChanceIfWon(bracket: BracketSeries[], from: number, teamRating: number, ratingOf: (teamId: number) => number | null): number | null {
  if (bracket[from].isFinal) return 1;
  let occupant = bracket[from].winner;
  let prob = 1;
  for (let i = from + 1; i < bracket.length; i++) {
    const s = bracket[i];
    if (!s.teams.includes(occupant)) continue;
    const opp = s.teams[0] === occupant ? s.teams[1] : s.teams[0];
    const r = ratingOf(opp);
    if (r == null) return null;
    prob *= seriesWinChance(s.format, neutralGameChance(teamRating, r));
    if (s.isFinal) return prob;
    occupant = s.winner;
  }
  return null;
}
