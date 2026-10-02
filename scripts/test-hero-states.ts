// Walks the dashboard hero (lib/nhl-schedule.ts chooseHero) through a real
// game-night timeline with a simulated clock — the states that can only be
// seen live a few hours a week: the day before, puck drop, the final horn
// before and after the hourly refresh loads the game, back-to-backs, and a
// refresh outage. Pure logic, no network or database.
//
// Usage: npx tsx scripts/test-hero-states.ts

import { chooseHero, type ClubGame, type GameState } from "../lib/nhl-schedule";

function game(id: number, date: string, startUTC: string, state: GameState, score?: [number, number]): ClubGame {
  return {
    id,
    season: "20262027",
    gameType: 2,
    gameDate: date,
    startTimeUTC: startUTC,
    venue: "TD Garden",
    isHome: true,
    opponent: "NYR",
    opponentName: "Rangers",
    state,
    teamScore: score?.[0] ?? null,
    oppScore: score?.[1] ?? null,
    endType: state === "FINAL" || state === "OFF" ? "regulation" : null,
    tv: ["ESPN"],
  };
}

const at = (iso: string) => Date.parse(iso);
const lastSeasonFinale = { id: 2025030116, date: "2026-05-01" };
const opener = (state: GameState, score?: [number, number]) => game(2026020003, "2026-09-29", "2026-09-30T00:00:00Z", state, score);
const g2 = game(2026020040, "2026-10-02", "2026-10-03T00:00:00Z", "FUT");
const g3 = game(2026020050, "2026-10-03", "2026-10-04T00:00:00Z", "FUT");

type Case = { name: string; games: ClubGame[]; last: { id: number; date: string; startedAt?: string } | null; now: number; expect: string; expectId?: number; maxDaysSince?: number };
const cases: Case[] = [
  { name: "day before the opener", games: [opener("FUT"), g2, g3], last: lastSeasonFinale, now: at("2026-09-28T15:00:00Z"), expect: "preview", expectId: 2026020003 },
  { name: "an hour before puck drop", games: [opener("PRE"), g2, g3], last: lastSeasonFinale, now: at("2026-09-29T23:00:00Z"), expect: "preview", expectId: 2026020003 },
  { name: "second period", games: [opener("LIVE", [2, 1]), g2, g3], last: lastSeasonFinale, now: at("2026-09-30T01:00:00Z"), expect: "pending", expectId: 2026020003 },
  { name: "final horn, refresh hasn't run", games: [opener("FINAL", [4, 2]), g2, g3], last: lastSeasonFinale, now: at("2026-09-30T02:40:00Z"), expect: "pending", expectId: 2026020003 },
  { name: "after the refresh loads the opener", games: [opener("OFF", [4, 2]), g2, g3], last: { id: 2026020003, date: "2026-09-29" }, now: at("2026-09-30T04:00:00Z"), expect: "recap" },
  { name: "game day for game 2", games: [opener("OFF", [4, 2]), g2, g3], last: { id: 2026020003, date: "2026-09-29" }, now: at("2026-10-02T14:00:00Z"), expect: "preview", expectId: 2026020040 },
  {
    name: "back-to-back: next game tonight, last one last night",
    games: [opener("OFF"), { ...g2, state: "OFF" }, g3],
    last: { id: 2026020040, date: "2026-10-02" },
    now: at("2026-10-03T15:00:00Z"),
    expect: "preview",
    expectId: 2026020050,
  },
  {
    name: "refresh outage: a final left unloaded for 2 days stops being 'pending'",
    games: [opener("OFF", [4, 2]), g2, g3],
    last: lastSeasonFinale,
    now: at("2026-10-02T02:00:00Z"),
    expect: "preview",
    expectId: 2026020040,
  },
  // Found live 2026-10-01: the opener (Tue 8 PM ET) read as 3+ days old by
  // Thu 8 PM ET because days were counted from midnight UTC of the date,
  // and the homepage's "Last game" button vanished. From the real start
  // time it's about 2 days.
  {
    name: "Thu 9 PM ET after a Tue 8 PM opener: last game is ~2 days old, not 3",
    games: [opener("OFF", [3, 0]), g2, g3],
    last: { id: 2026020003, date: "2026-09-29", startedAt: "2026-09-30T00:00:00Z" },
    now: at("2026-10-02T01:00:00Z"),
    expect: "preview",
    expectId: 2026020040,
    maxDaysSince: 2.1,
  },
  { name: "no schedule from the API (fetch failed)", games: [], last: lastSeasonFinale, now: at("2026-09-28T15:00:00Z"), expect: "recap" },
  { name: "nothing at all", games: [], last: null, now: at("2026-09-28T15:00:00Z"), expect: "none" },
];

let failed = 0;
for (const c of cases) {
  const r = chooseHero(c.games, c.last, c.now);
  const id = r.hero === "pending" ? r.pending?.id : r.hero === "preview" ? r.next?.id : undefined;
  const ok = r.hero === c.expect && (c.expectId === undefined || id === c.expectId) && (c.maxDaysSince === undefined || r.daysSinceLast <= c.maxDaysSince);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}: ${r.hero}${id ? ` (${id})` : ""}${c.maxDaysSince !== undefined ? `, ${r.daysSinceLast.toFixed(2)} days since last` : ""}${ok ? "" : ` — expected ${c.expect}${c.expectId ? ` (${c.expectId})` : ""}`}`);
}
console.log(`\n${cases.length - failed}/${cases.length} passed.`);
process.exit(failed ? 1 : 0);
