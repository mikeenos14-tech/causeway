// Tests the season pickers' history (lib/history-data.ts) against hockey
// facts: era-correct records and round names, the Bruins' six Cups, famous
// series, and the historical game page's content for games fans know.
//
// Usage: npx tsx --env-file=.env.local scripts/test-history-pages.ts

import { eraRecord, eraResult, roundName, getHistorySeasonSchedule, getHistoricalPlayoffSeries, getHistoryGame, getBruinsSeasons, BOS_TEAM_ID } from "../lib/history-data";
import { pool } from "../lib/db";
import { getHistoricalStandings, getHistoricalStandingsSeasons } from "../lib/history-standings";
import { teamNickname } from "../lib/team-names";
import { getThisDay } from "../lib/this-day";
import { getBruinsEloSeasons } from "../lib/elo-seasons";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
};

async function record(season: string, teamId = BOS_TEAM_ID) {
  const rows = (await getHistorySeasonSchedule(season, teamId)).filter((r) => r.gameType === "regular");
  return eraRecord(season, rows.map((r) => ({ team: r.team, opp: r.opp, finalState: r.finalState, otEmptyNet: r.otEmptyNet })));
}

async function main() {
  // Unit: era rules
  check("pre-1999 OT loss is a loss, not OTL", eraResult("19851986", "regular", 3, 4, "OT") === "L");
  check("1999-2004 OT loss is OTL", eraResult("20002001", "regular", 3, 4, "OT") === "OTL");
  check("playoff OT loss is never OTL", eraResult("20102011", "playoff", 1, 2, "OT") === "L");
  check("tie is T", eraResult("19701971", "regular", 3, 3, "TIE") === "T");
  check("OT loss on an empty-net goal is L, not OTL (no loser point)", eraResult("19992000", "regular", 3, 4, "OT", true) === "L");
  check("VAN 1999-2000 is 30-29-15-8, as the NHL's standings", (await record("19992000", 23)) === "30-29-15-8", await record("19992000", 23));
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

  // Historical standings (the Standings season picker)
  const st71 = await getHistoricalStandings("19701971");
  const bos71 = st71?.rows.find((r) => r.code === "BOS");
  check("1970-71 standings: BOS 57-14-7, 121 pts, 1st in the East", bos71?.w === 57 && bos71.l === 14 && bos71.t === 7 && bos71.pts === 121 && bos71.rank === 1 && bos71.group === "East", JSON.stringify(bos71));
  const st51 = await getHistoricalStandings("19501951");
  check("1950-51: one six-team league table", st51?.rows.length === 6 && new Set(st51.rows.map((r) => r.group)).size === 1 && st51.rows[0].group === "League");
  const st27 = await getHistoricalStandings("19261927");
  check("1926-27: American and Canadian divisions", JSON.stringify([...new Set(st27?.rows.map((r) => r.group))].sort()) === JSON.stringify(["American", "Canadian"]));
  const st00 = await getHistoricalStandings("19992000");
  check("1999-00: six divisions, 16 playoff teams", new Set(st00?.rows.map((r) => r.group)).size === 6 && st00!.rows.filter((r) => r.madePlayoffs).length === 16);
  const st21 = await getHistoricalStandings("20202021");
  check("2020-21: divisions without sponsor names", JSON.stringify([...new Set(st21?.rows.map((r) => r.group))].sort()) === JSON.stringify(["Central", "East", "North", "West"]));
  check("2004-05 (lockout) has no standings", !(await getHistoricalStandingsSeasons()).includes("20042005"));
  // Invariants over every season: each decided game has one winner and one
  // loser (W = L + OTL league-wide), and league GF = GA.
  const bad: string[] = [];
  for (const season of await getHistoricalStandingsSeasons()) {
    const sst = await getHistoricalStandings(season);
    if (!sst) continue;
    const sum = (k: "w" | "l" | "otl" | "gf" | "ga") => sst.rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
    if (sum("w") !== sum("l") + sum("otl")) bad.push(`${season} W ${sum("w")} vs L+OTL ${sum("l") + sum("otl")}`);
    if (sst.rows.every((r) => r.gf != null) && sum("gf") !== sum("ga")) bad.push(`${season} GF ${sum("gf")} vs GA ${sum("ga")}`);
  }
  check("every season: league W = L + OTL, and GF = GA", bad.length === 0, bad.slice(0, 5).join("; "));
  check("short names: (1917) Senators, Maple Leafs, St. Patricks", teamNickname("SEN", "Ottawa Senators (1917)") === "Senators" && teamNickname("TOR", "Toronto Maple Leafs") === "Maple Leafs" && teamNickname("TSP", "Toronto St. Patricks") === "St. Patricks");

  // This day in Bruins history
  const may10 = await getThisDay(new Date("2026-05-10T15:00:00Z"));
  check("this day, May 10: Orr's flying goal first, 1970 Final Game 4 in OT, 56 years ago", may10[0]?.headline === "Orr's flying goal" && may10[0].facts.includes("Stanley Cup Final, Game 4") && may10[0].facts.includes("Overtime") && may10[0].yearsAgo === 56, JSON.stringify(may10[0]));
  const apr2 = await getThisDay(new Date("2026-04-02T15:00:00Z"));
  check("this day, Apr 2: Sudden Death Hill, 1939 Semifinal Game 7, 3 overtimes", apr2[0]?.headline === "Sudden Death Hill" && apr2[0].facts.includes("Semifinal, Game 7") && apr2[0].facts.includes("3 overtimes"), JSON.stringify(apr2[0]?.facts));
  const oct2 = await getThisDay(new Date("2026-10-02T15:00:00Z"));
  check("this day, Oct 2: two season openers, 1997 win first", oct2.length === 2 && oct2[0].date === "1997-10-02" && oct2.every((g) => g.facts.includes("Season opener")));
  check("this day, Jul 20: nothing (no Bruins game ever on that date)", (await getThisDay(new Date("2026-07-20T15:00:00Z"))).length === 0);
  check("this day, late evening ET still counts as that date", (await getThisDay(new Date("2026-10-03T03:30:00Z"))).every((g) => g.date.slice(5) === "10-02"));

  // Every Bruins season ranked by Elo
  const elo = await getBruinsEloSeasons();
  const done = elo.filter((x) => !x.current);
  check("Elo seasons: 1970-71 has the highest peak, 1971-72 second", done[0]?.seasonId === "19701971" && done[1]?.seasonId === "19711972", done.slice(0, 2).map((x) => x.seasonId).join(","));
  check("Elo seasons: outcomes match history (1970-71 lost QF, 1971-72 Cup, 1973-74 lost Final, 2010-11 Cup)",
    elo.find((x) => x.seasonId === "19701971")?.outcome === "Lost in the Quarterfinal" && elo.find((x) => x.seasonId === "19711972")?.cup === true &&
    elo.find((x) => x.seasonId === "19731974")?.outcome === "Lost in the Final" && elo.find((x) => x.seasonId === "20102011")?.cup === true);
  check("Elo seasons: six Cups, one current season, every season present", elo.filter((x) => x.cup).length === 6 && elo.filter((x) => x.current).length === 1 && elo.length === (await getBruinsSeasons()).length);

  await pool.end();
  console.log(`\n${failed === 0 ? "All passed." : `${failed} failed.`}`);
  process.exit(failed ? 1 : 0);
}

main();
