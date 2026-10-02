// Tests the season pickers' history (lib/history-data.ts) against hockey
// facts: era-correct records and round names, the Bruins' six Cups, famous
// series, and the historical game page's content for games fans know.
//
// Usage: npx tsx --env-file=.env.local scripts/test-history-pages.ts

import { eraRecord, eraResult, roundName, getHistorySeasonSchedule, getHistoricalPlayoffSeries, getHistoryGame, getBruinsSeasons, BOS_TEAM_ID } from "../lib/history-data";
import { pool } from "../lib/db";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
};

async function record(season: string) {
  const rows = (await getHistorySeasonSchedule(season)).filter((r) => r.gameType === "regular");
  return eraRecord(season, rows.map((r) => ({ team: r.team, opp: r.opp, finalState: r.finalState })));
}

async function main() {
  // Unit: era rules
  check("pre-1999 OT loss is a loss, not OTL", eraResult("19851986", "regular", 3, 4, "OT") === "L");
  check("1999-2004 OT loss is OTL", eraResult("20002001", "regular", 3, 4, "OT") === "OTL");
  check("playoff OT loss is never OTL", eraResult("20102011", "playoff", 1, 2, "OT") === "L");
  check("tie is T", eraResult("19701971", "regular", 3, 3, "TIE") === "T");
  check("round names: 1970 final", roundName("19691970", 3, 3) === "Stanley Cup Final");
  check("round names: 1979 semifinal (4-round era)", roundName("19781979", 3, 4) === "Semifinal");
  check("round names: 2011 conference final", roundName("20102011", 3, 4) === "Conference Final");
  check("round names: 1920s NHL final before the NHL owned the Cup", roundName("19211922", 1, 1) === "NHL Final");
  check("round names: 2020 qualifying round", roundName("20192020", 0, 4) === "Qualifying round");

  // Records as that era wrote them (Bruins, from official totals)
  for (const [season, want] of [
    ["19291930", "38-5-1"],
    ["19381939", "36-10-2"],
    ["19701971", "57-14-7"],
    ["19711972", "54-13-11"],
    ["20002001", "36-30-8-8"],
    ["20052006", "29-37-16"],
  ] as const) {
    const got = await record(season);
    check(`Bruins ${season.slice(0, 4)}-${season.slice(6)} record ${want}`, got === want, got);
  }

  const seasons = await getBruinsSeasons();
  check("Bruins seasons run from 1924-25 to now", seasons.at(-1) === "19241925" && seasons[0] >= "20262027", `${seasons.at(-1)} … ${seasons[0]}`);
  check("no Bruins season 2004-05 (lockout)", !seasons.includes("20042005"));

  // Playoffs before 2007-08
  const series = await getHistoricalPlayoffSeries(BOS_TEAM_ID);
  const cups = series.filter((s) => s.won && s.round === s.maxRoundThatSeason && s.seasonId >= "19261927").map((s) => s.seasonId.slice(4));
  check("Cups before 2007-08: 1929, 1939, 1941, 1970, 1972", JSON.stringify(cups) === JSON.stringify(["1929", "1939", "1941", "1970", "1972"]), cups.join(", "));
  const s79 = series.find((s) => s.seasonId === "19781979" && s.opponentAbbrev === "MTL");
  check("1979 semifinal vs MTL: lost 3-4", s79?.roundName === "Semifinal" && !s79.won && s79.teamWins === 3 && s79.opponentWins === 4, JSON.stringify(s79 && { r: s79.roundName, w: s79.teamWins, l: s79.opponentWins }));
  const s27 = series.find((s) => s.seasonId === "19261927" && s.maxRoundThatSeason === s.round);
  check("1927 Final vs the original Senators: lost, not linked to today's Senators", !!s27 && !s27.won && !s27.opponentLinkable && s27.ties === 2, JSON.stringify(s27 && { opp: s27.opponentAbbrev, w: s27.teamWins, l: s27.opponentWins, t: s27.ties, link: s27.opponentLinkable }));
  const qf = (season: string, opp: string) => series.find((s) => s.seasonId === season && s.opponentAbbrev === opp)?.roundName;
  check("1929 vs MTL (first-place teams) is a Semifinal", qf("19281929", "MTL") === "Semifinal", qf("19281929", "MTL"));
  check("1936 vs TOR (two-game total goals) is a Quarterfinal", qf("19351936", "TOR") === "Quarterfinal", qf("19351936", "TOR"));
  check("1937 vs Maroons is a Quarterfinal", qf("19361937", "MMR") === "Quarterfinal", qf("19361937", "MMR"));
  check("1942: beat CHI in the Quarterfinal, lost to DET in the Semifinal", qf("19411942", "CHI") === "Quarterfinal" && qf("19411942", "DET") === "Semifinal");
  check("1939 vs NYR (1st vs 2nd) is a Semifinal", qf("19381939", "NYR") === "Semifinal");
  check("roundName 1942 series 4 is Semifinal, 1943 round 1 is Semifinal", roundName("19411942", 1, 2, 4) === "Semifinal" && roundName("19421943", 1, 2, 2) === "Semifinal");
  check("1988 Final opponent (EDM) links to today's Oilers", series.some((s) => s.seasonId === "19871988" && s.opponentAbbrev === "EDM" && s.opponentLinkable));

  // Historical game pages
  const orr = await getHistoryGame(1969030314);
  check("Orr game page: 1970 Stanley Cup Final, Game 4; BOS 4-3 OT", orr?.stage === "1970 Stanley Cup Final, Game 4" && orr.home.score === 4 && orr.away.score === 3 && orr.finalState === "OT", orr?.stage ?? "missing");
  check("Orr game page: last goal Bobby Orr at 0:40 OT, from Sanderson", orr?.goals.at(-1)?.scorer === "Bobby Orr" && orr.goals.at(-1)?.time === "0:40" && orr.goals.at(-1)?.assists[0] === "Derek Sanderson", JSON.stringify(orr?.goals.at(-1)));
  check("Orr game page: iconic story attached", orr?.iconic?.label === "Orr's flying goal");
  const tie = await getHistoryGame(1967020130);
  check("Bucyk record game: 4-4 tie with Chicago", tie?.finalState === "TIE" && tie.home.score === 4 && tie.away.score === 4);
  const first = await getHistoryGame(1924020001).catch(() => null);
  const boston1924 = (await getHistorySeasonSchedule("19241925"))[0];
  check("first Bruins game: Dec 1, 1924, beat the Maroons", boston1924?.date === "1924-12-01" && boston1924.team > boston1924.opp && boston1924.opponent === "MMR", JSON.stringify(boston1924));
  void first;

  await pool.end();
  console.log(`\n${failed === 0 ? "All passed." : `${failed} failed.`}`);
  process.exit(failed ? 1 : 0);
}

main();
