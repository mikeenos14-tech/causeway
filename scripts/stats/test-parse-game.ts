// Tests lib/stats/parse-game.ts on games whose details are known, fetched
// live from the NHL feed (a handful of requests). Each case checks what a
// fan would check: the right goal, at the right time, by the right player,
// with the right final state.
//
// Usage: npx tsx scripts/stats/test-parse-game.ts

import { parseGame, strengthFromSituation, type ListRow, type ParsedGame } from "../../lib/stats/parse-game";

// Retries: the feed returns an HTML error page under load (e.g. while the
// history backfill is running).
async function get(url: string): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "causeway-tests/1.0" } });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      if (attempt >= 5) throw new Error(`Not JSON after retries (HTTP ${res.status}): ${url}`);
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
}

async function load(id: number): Promise<ParsedGame> {
  const [pbp, landing] = await Promise.all([get(`https://api-web.nhle.com/v1/gamecenter/${id}/play-by-play`), get(`https://api-web.nhle.com/v1/gamecenter/${id}/landing`)]);
  const list: ListRow = {
    id,
    season: pbp.season,
    gameType: pbp.gameType,
    gameDate: pbp.gameDate,
    homeTeamId: pbp.homeTeam.id,
    visitingTeamId: pbp.awayTeam.id,
    homeScore: pbp.homeTeam.score,
    visitingScore: pbp.awayTeam.score,
  };
  return parseGame(list, pbp, landing);
}

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
}

async function main() {
  // Pure-function unit cases first.
  check("situation 1551, home scores: EV", strengthFromSituation("1551", true)?.strength === "EV");
  check("situation 1451, home scores: PP", strengthFromSituation("1451", true)?.strength === "PP");
  check("situation 1451, away scores: SH", strengthFromSituation("1451", false)?.strength === "SH");
  check("situation 0651, home scores into empty net: EV, empty net", JSON.stringify(strengthFromSituation("0651", true)) === JSON.stringify({ strength: "EV", emptyNet: true }));
  check("situation 1560, home extra attacker scores: EV, not PP", strengthFromSituation("1560", true)?.strength === "EV" && strengthFromSituation("1560", true)?.emptyNet === false);
  check("situation 1560, away scores into the home team's empty net", strengthFromSituation("1560", false)?.emptyNet === true);

  // 1970 Final Game 4: Orr's flying goal, 0:40 of overtime, Sanderson assist.
  const orr = await load(1969030314);
  const last = orr.goals.at(-1)!;
  check("1970 G4: BOS 4-3 in OT", orr.game.home_score === 4 && orr.game.away_score === 3 && orr.game.final_state === "OT", JSON.stringify(orr.game));
  check("1970 G4: last goal is Orr (8450070) at 0:40 of period 4", last.scorer_id === 8450070 && last.period === 4 && last.time_in_period_sec === 40 && last.period_type === "OT", JSON.stringify(last));
  check("1970 G4: Sanderson (8448671) primary assist", last.assist1_id === 8448671);
  check("1970 G4: game was tied 3-3 before Orr scored", last.score_before_home === 3 && last.score_before_away === 3);
  check("1970 G4: goal events add up to the final", orr.game.goals_match_final && orr.game.goals_with_time === 7);
  check("1970 G4: venue Boston Garden, Boston", orr.game.venue_name === "Boston Garden" && orr.game.venue_city === "Boston");

  // 1979 semifinal Game 7: too many men, Montreal wins 5-4 at 9:33 of OT.
  const g79 = await load(1978030327);
  const w79 = g79.goals.at(-1)!;
  check("1979 G7: MTL 5-4 over BOS in OT", g79.game.home_team_id === 8 && g79.game.home_score === 5 && g79.game.away_score === 4 && g79.game.final_state === "OT");
  check("1979 G7: winner at 9:33 of overtime by MTL", w79.period === 4 && w79.time_in_period_sec === 573 && w79.team_id === 8);
  check("1979 G7: Montreal's tying goal was a power play (too many men)", g79.goals.some((g) => g.team_id === 8 && g.period === 3 && g.strength === "PP"), JSON.stringify(g79.goals.filter((g) => g.period === 3)));

  // 2013 Round 1 Game 7: down 4-1 in the third, Bergeron wins it in OT.
  const g13 = await load(2012030147);
  const w13 = g13.goals.at(-1)!;
  check("2013 G7: BOS 5-4 OT", g13.game.home_score === 5 && g13.game.away_score === 4 && g13.game.final_state === "OT");
  check("2013 G7: Bergeron (8470638) scores the OT winner", w13.scorer_id === 8470638 && w13.period === 4);
  check("2013 G7: Toronto led 4-1 at some point in the third", g13.goals.some((g) => g.period === 3 && g.score_before_home === 1 && g.score_before_away === 4));
  check("2013 G7: has situation codes and shot events (tier A+ era)", g13.game.has_situation_codes && g13.game.has_shot_events);
  check("2013 G7: period shots add up to the game total", g13.periods.reduce((s, p) => s + (p.home_shots ?? 0), 0) === g13.game.home_sog, `${g13.periods.map((p) => p.home_shots)} vs ${g13.game.home_sog}`);

  // 2026-27 opener: Kastelic's empty-net goal, an even-strength one.
  const op = await load(2026020003);
  const en = op.goals.at(-1)!;
  check("Opener: last goal is an empty-net, even-strength goal", en.empty_net === true && en.strength === "EV", JSON.stringify(en));
  check("Opener: no other goal flagged empty net", op.goals.slice(0, -1).every((g) => g.empty_net === false));

  // A shootout game: the list score includes the shootout winner's +1.
  const so = await load(2015020019);
  check("Shootout game: final state SO and goals add up (minus the shootout goal)", so.game.final_state === "SO" && so.game.goals_match_final, JSON.stringify(so.game));
  check("Shootout game: no shootout attempts stored as goals", so.goals.every((g) => g.period <= 4));

  // The first NHL game: 1917-12-19, Montreal 7 at Ottawa 4.
  const first = await load(1917020001);
  check("1917 opener: MTL 7 @ OTT 4, 11 timed goals", first.game.away_score === 7 && first.game.home_score === 4 && first.game.goals_with_time === 11 && first.game.goals_match_final);

  console.log(`\n${failed === 0 ? "All passed." : `${failed} failed.`}`);
  process.exit(failed ? 1 : 0);
}

main();
