// Tests the recap validators (lib/narrate-recap.ts validateRecap) against
// real fact sheets and real text: text that must pass (taken from a trial
// run of the grounded recaps) and text that must be rejected (each failure
// shape found live or anticipated). No model calls — the validator is
// deterministic code and is tested as such.
//
// Usage: npx tsx --env-file=.env.local scripts/test-recap-validators.ts

import { Client } from "pg";
import { buildGameFacts, type GameFacts } from "../lib/game-facts";
import { validateRecap } from "../lib/narrate-recap";

type Case = { name: string; game: number; headline: string; body: string; expect: "pass" | "reject" };

const cases: Case[] = [
  // Must pass — real trial output.
  {
    name: "Game 6 elimination, shots even, xG favors BUF",
    game: 2025030116,
    headline: "Sabres end Bruins' season in Game 6",
    body: "Buffalo eliminated Boston 4-1 in the first round. Despite matching shots at 26 apiece, the expected goals favored Buffalo 3.64 to 2.27.",
    expect: "pass",
  },
  {
    name: "a real season opener",
    game: 2009020001,
    headline: "Caps spoil season opener at TD Garden",
    body: "Brooks Laich and Alex Ovechkin each scored twice for Washington, while Patrice Bergeron had the lone goal for Boston. Tim Thomas stopped 30 of 34.",
    expect: "pass",
  },
  {
    name: "regular-season 'game 4' as the sheet states it",
    game: 2021020079,
    headline: "Bruins hold off Sharks, 4-3",
    body: "Game 4 of the season went Boston's way, with Pastrnak, Forbort, Marchand, and DeBrusk all scoring. Ullmark made 23 saves.",
    expect: "pass",
  },
  {
    name: "sentence starting 'Nothing' is not a name",
    game: 2025030116,
    headline: "Bruins bow out",
    body: "Nothing went right for Boston in a 4-1 loss. David Pastrnak had the only goal.",
    expect: "pass",
  },
  // Must reject.
  { name: "invented home opener (Oct 2021 was game 4)", game: 2021020079, headline: "Bruins win home opener", body: "Boston beat San Jose 4-3.", expect: "reject" },
  { name: "invented game-winner (no play-by-play)", game: 2021020079, headline: "DeBrusk's winner", body: "Jake DeBrusk scored the game-winner in a 4-3 win.", expect: "reject" },
  { name: "invented period detail", game: 2021020079, headline: "Late push", body: "Boston scored twice in the third period to beat San Jose 4-3.", expect: "reject" },
  { name: "invented comeback", game: 2021020079, headline: "Comeback win", body: "Boston rallied to beat San Jose 4-3.", expect: "reject" },
  { name: "invented player", game: 2025030116, headline: "Bruins fall", body: "Marchand scored late but Buffalo won 4-1.", expect: "reject" },
  { name: "nickname not on the sheet", game: 2025030116, headline: "Pasta scores lone goal", body: "Pasta's goal wasn't enough in a 4-1 loss.", expect: "reject" },
  { name: "invented number", game: 2025030116, headline: "Bruins fall 4-1", body: "Swayman made 31 saves in the loss.", expect: "reject" },
  { name: "dominance with no shot data (2009-10 has only xG... use a sheet with neither)", game: 0, headline: "Caps dominate", body: "Washington dominated Boston 4-1.", expect: "reject" },
  { name: "hype word", game: 2025030116, headline: "A historic collapse", body: "Buffalo beat Boston 4-1.", expect: "reject" },
  { name: "wrong venue (home game placed in the away city)", game: 2025030116, headline: "Loss in Buffalo", body: "Boston lost 4-1 in Buffalo.", expect: "reject" },
  { name: "wrong playoff game number", game: 2025030116, headline: "Game 7 heartbreak", body: "Buffalo won Game 7 4-1.", expect: "reject" },
  { name: "comparison stated backwards (trial output, TBL led xG)", game: 2025020040, headline: "Lightning win", body: "Boston dominated expected goals 2.46 to 3.54 but lost 4-3.", expect: "reject" },
  { name: "comparison stated the right way round", game: 2025020040, headline: "Lightning win anyway", body: "Boston outshot Tampa Bay 33-23 but lost 4-3.", expect: "pass" },
  { name: "a real season finale (2015-16 game 82, proven by the data)", game: 2015021216, headline: "Senators spoil the finale", body: "Ottawa beat Boston 6-1.", expect: "pass" },
  { name: "finale claimed for a mid-season game", game: 2021020079, headline: "Season finale win", body: "Boston beat San Jose 4-3.", expect: "reject" },
  { name: "shot leader inverted (published trial output; CBJ outshot BOS 35-22)", game: 2025021278, headline: "Bruins steal one", body: "The Bruins won the shot battle, outshooting Columbus 35-22, and Joonas Korpisalo made 33 saves.", expect: "reject" },
  { name: "shot leader inverted, object form", game: 2025021278, headline: "Bruins win 3-2", body: "Boston outshot the Blue Jackets 35-22 in a 3-2 win.", expect: "reject" },
  { name: "shot leader stated correctly", game: 2025021278, headline: "Korpisalo steals one", body: "Columbus outshot Boston 35-22, but Joonas Korpisalo made 33 saves in a 3-2 win.", expect: "pass" },
  { name: "passive voice, correct direction", game: 2025021278, headline: "Bruins win anyway", body: "Boston was outshot 35-22 by Columbus but won 3-2.", expect: "pass" },
  { name: "team nickname (Philly) is not a player", game: 2025021224, headline: "Bruins fall in Philly", body: "Pavel Zacha scored, but Philly won 2-1 in overtime.", expect: "pass" },
  { name: "Game 1 called the series opener", game: 2025030111, headline: "Sabres take the series opener", body: "Buffalo won Game 1, 4-3.", expect: "pass" },
  { name: "a score right after 'game' is not a game number", game: 2025030111, headline: "Sabres take Game 1", body: "Buffalo won the opening game 4-3.", expect: "pass" },
  { name: "series record passed off as season record (trial output)", game: 2023020021, headline: "Bruins win", body: "Bruins improve to 1-0-0 on the young season with a 3-2 win.", expect: "reject" },
  { name: "season record stated correctly", game: 2023020021, headline: "Bruins win", body: "Bruins improve to 2-0-0 with a 3-2 win over Nashville.", expect: "pass" },
  { name: "series record stated correctly", game: 2023020021, headline: "Bruins win", body: "Boston is 1-0-0 against Nashville this season after a 3-2 win.", expect: "pass" },
  { name: "'blown out' is about the score, not a blown lead", game: 2013020370, headline: "Bruins blown out in Detroit, 6-1", body: "Detroit beat Boston 6-1.", expect: "pass" },
  { name: "blew a lead (unknowable without play-by-play)", game: 2021020079, headline: "Bruins win", body: "Boston blew a lead but won 4-3.", expect: "reject" },
  { name: "overtime claimed for a regulation game", game: 2025030116, headline: "Overtime loss", body: "Buffalo won 4-1 in overtime.", expect: "reject" },
];

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const sheets = new Map<number, GameFacts>();
  // A synthetic sheet with no shots or xG, for the dominance case — derived
  // from a real one with the team-stat lines removed.
  for (const c of cases) {
    if (c.game && !sheets.has(c.game)) sheets.set(c.game, (await buildGameFacts(client, c.game, "BOS"))!);
  }
  const base = sheets.get(2009020001)!;
  const noStats = base.lines.filter((l) => !/Shots on goal|Expected goals|Power play/.test(l));
  sheets.set(0, { ...base, lines: noStats, text: noStats.join("\n"), hasTeamStats: false });
  await client.end();

  let failed = 0;
  for (const c of cases) {
    let outcome: "pass" | "reject" = "pass";
    let why = "";
    try {
      validateRecap({ headline: c.headline, body: c.body }, sheets.get(c.game)!);
    } catch (e) {
      outcome = "reject";
      why = (e as Error).message.slice(0, 110);
    }
    const ok = outcome === c.expect;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}: ${outcome}${why && !ok ? ` — ${why}` : ""}`);
  }
  console.log(`\n${cases.length - failed}/${cases.length} passed.`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
