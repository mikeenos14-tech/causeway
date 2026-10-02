// Tests Leverage Goals: the series math, the stored per-goal and per-game
// numbers against the win probability charts, the spec's acceptance
// checks, and the player totals against official goal counts.
//
// Usage: npx tsx --env-file=.env.local scripts/stats/test-leverage.ts

import { pool } from "../../lib/db";
import { getGameWpTimeline } from "../../lib/wp-game";
import { seriesChance, gameStakes, seriesFormat, neutralGameChance, cupChanceIfWon, type BracketSeries } from "../../lib/stats/leverage";
import { getClutchCard, getBruinsLeverageLeaders, getBruinsBiggestGoals, getBiggestGoals, getLeverageSeasons } from "../../lib/leverage-data";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
};
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) < tol;

(async () => {
  // Series math.
  check("even best-of-7 from 0-0 is 50%", near(seriesChance(0, 0, 4, 0.5), 0.5));
  check("Game 7 stakes are exactly 1, whoever is favored", near(gameStakes(3, 3, 4, 0.5), 1) && near(gameStakes(3, 3, 4, 0.8), 1));
  check("Game 1 of an even best-of-7: 0.3125 (spec: about 0.3)", near(gameStakes(0, 0, 4, 0.5), 0.3125));
  check("up 3-0, the next game matters little", gameStakes(3, 0, 4, 0.7) < 0.05);
  check("equal ratings give 50% on neutral ice", near(neutralGameChance(1500, 1500), 0.5));
  const sg = (a: number, b: number) => ({ id: 0, teamA: 1, aScore: a, bScore: b });
  check("1925-26 two-game series is total goals", seriesFormat("19251926", [sg(1, 1), sg(2, 0)]).kind === "total-goals");
  check("1929 Final (2-0) is best-of-3, not total goals", JSON.stringify(seriesFormat("19281929", [sg(2, 0), sg(2, 1)], true)) === JSON.stringify({ kind: "best-of", need: 2 }));
  check("a 2-0 quarterfinal in 1929 stays total goals", seriesFormat("19281929", [sg(2, 0), sg(2, 1)], false).kind === "total-goals");
  check("1927 Final (2 wins, 2 ties) is irregular, not guessed", seriesFormat("19261927", [sg(0, 0), sg(2, 0), sg(1, 1), sg(3, 1)]).kind === "irregular");
  check("a 4-3 series is best-of-7", JSON.stringify(seriesFormat("20102011", [sg(0, 1), sg(0, 1), sg(1, 0), sg(1, 0), sg(1, 0), sg(0, 1), sg(1, 0)])) === JSON.stringify({ kind: "best-of", need: 4 }));
  check("a series the 'winner' didn't finish is irregular", seriesFormat("20102011", [sg(1, 0), sg(1, 0), sg(1, 0), sg(0, 1)]).kind === "irregular");

  // Cup chance through a bracket: semis then a final, everyone rated equal.
  const bo7 = { kind: "best-of" as const, need: 4 };
  const br: BracketSeries[] = [
    { teams: [1, 2], winner: 1, format: bo7, isFinal: false },
    { teams: [3, 4], winner: 4, format: bo7, isFinal: false },
    { teams: [1, 4], winner: 4, format: bo7, isFinal: true },
  ];
  check("Cup chance from a Final is 1", cupChanceIfWon(br, 2, 1500, () => 1500) === 1);
  check("Cup chance from an even semifinal is the Final's 50%", near(cupChanceIfWon(br, 0, 1500, () => 1500)!, 0.5));
  check("...for the semifinal's loser too (it would take the winner's slot)", near(cupChanceIfWon(br, 0, 1500, () => 1500)!, 0.5));
  check("a stronger team's Cup chance is higher", cupChanceIfWon(br, 1, 1600, () => 1500)! > 0.5);
  check("a broken bracket gives no number, not a guess", cupChanceIfWon([{ teams: [1, 2], winner: 1, format: bo7, isFinal: false }], 0, 1500, () => 1500) === null);

  const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];

  // Acceptance: goals + clock drift = final - pregame, every game (as stored).
  const recon = await one(`select count(*)::int n, max(abs(pregame + goal_wpa + drift - final))::float worst from leverage_games`);
  check(`goals + clock drift reconcile to the result in all ${recon.n} games (stored precision)`, recon.worst < 1e-5, String(recon.worst));
  // The stored goals add up to each game's goal total.
  const sums = await one(
    `select count(*)::int bad from leverage_games l join (
       select w.game_id, sum(case when e.team_id = g.home_team_id then w.wp_after - w.wp_before else -(w.wp_after - w.wp_before) end) s
       from goal_wpa w join nhl_goal_events e using (game_id, event_id) join nhl_games g on g.id = w.game_id group by w.game_id) x using (game_id)
     where abs(x.s - l.goal_wpa) > 1e-4`,
  );
  check("each game's goals sum to its stored goal total", sums.bad === 0, `${sums.bad} games`);
  const cover = await one(`select count(*)::int n from leverage_games l where (select count(*) from goal_wpa w where w.game_id = l.game_id) <> (select count(*) from nhl_goal_events e where e.game_id = l.game_id)`);
  check("every goal of every scored game has a row", cover.n === 0, `${cover.n} games`);
  const neg = await one(`select count(*)::int n from goal_wpa where wp_after < wp_before - 1e-6`);
  check("no goal ever lowers its own team's chance", neg.n === 0, String(neg.n));

  // Acceptance: sudden-death OT winners worth roughly 0.4-0.6 (OT starts
  // near a coin flip; team strength moves playoff OT starts more).
  const ot = await one(
    `select count(*)::int n, min(w.wp_after - w.wp_before)::float mn, max(w.wp_after - w.wp_before)::float mx,
            percentile_cont(0.05) within group (order by w.wp_after - w.wp_before)::float p5, percentile_cont(0.95) within group (order by w.wp_after - w.wp_before)::float p95
     from goal_wpa w join nhl_goal_events e using (game_id, event_id) join nhl_games g on g.id = w.game_id
     where e.period_type = 'OT' and g.final_state = 'OT' and (g.game_type = 'playoff' or g.season >= '19831984')
       and e.time_elapsed_sec = (select max(time_elapsed_sec) from nhl_goal_events x where x.game_id = g.id)`,
  );
  check(`sudden-death OT winners (${ot.n}): 90% between 0.35 and 0.65`, ot.p5 > 0.35 && ot.p95 < 0.65, JSON.stringify(ot));
  check("every sudden-death OT winner between 0.2 and 0.8", ot.mn > 0.2 && ot.mx < 0.8, JSON.stringify(ot));

  // Stakes: Game 7s are 1; regular season has none.
  const g7 = await one(`select count(*)::int n, min(stakes)::float mn from leverage_games where series_format = 'best-of-7' and game_id % 10 = 7`);
  check(`all ${g7.n} best-of-7 Game 7s have stakes 1`, near(g7.mn, 1, 1e-6));
  const reg = await one(`select count(*)::int n from goal_wpa w join nhl_games g on g.id = w.game_id where g.game_type = 'regular' and w.stakes is not null`);
  check("no stakes on regular-season goals", reg.n === 0);

  // Stored per-goal numbers match the game's win probability chart.
  for (const id of [2012030147, 2010030417, 1969030314, 2023020100]) {
    const tl = await getGameWpTimeline(id);
    const { rows } = await pool.query(
      `select e.time_elapsed_sec t, e.team_id = g.home_team_id home, w.wp_before b, w.wp_after a from goal_wpa w join nhl_goal_events e using (game_id, event_id) join nhl_games g on g.id = w.game_id where w.game_id = $1 order by e.time_elapsed_sec, e.event_id`,
      [id],
    );
    const goalPts = tl!.points.map((p, i) => ({ p, prev: tl!.points[i - 1] })).filter((x) => x.p.goal);
    const ok = rows.length === goalPts.length && rows.every((r, i) => {
      const side = (v: number) => (r.home ? v : 1 - v);
      return near(r.b, side(goalPts[i].prev.p), 1e-5) && near(r.a, side(goalPts[i].p.p), 1e-5);
    });
    check(`game ${id}: stored goal chances match its chart`, ok);
  }

  // Smell tests (spec section 8).
  const berg = await one(
    `select rank::int from (select w.game_id, e.period, e.time_in_period_sec, rank() over (order by w.wp_after - w.wp_before desc) from goal_wpa w join nhl_goal_events e using (game_id, event_id) where e.period_type = 'REG') r
     where game_id = 2012030147 and period = 3 and time_in_period_sec = 1149`,
  );
  const total = await one(`select count(*)::int n from goal_wpa`);
  check(`Bergeron's 2013 G7 tying goal is in the top 0.1% of regulation goals by WPA (#${berg.rank} of ${total.n})`, berg.rank <= total.n / 1000);
  const g7goals = await one(`select max(w.wp_after - w.wp_before)::float mx from goal_wpa w where w.game_id = 2012030147`);
  check("...and it's the biggest goal of that game (+0.51)", near(g7goals.mx, 0.509, 0.01), String(g7goals.mx));

  // Player totals: goals match official career counts where our box
  // history covers the whole career (pre-2007 careers).
  const { rows: careers } = await pool.query(
    `select p.full_name, (select sum(goals) from player_leverage l where l.player_id = p.id and l.game_type = 'regular')::int lev,
            (select sum(s.goals) from nhl_skater_games s join nhl_games g on g.id = s.game_id where s.player_id = p.id and g.game_type = 'regular' and s.played)::int box
     from nhl_players p where p.full_name in ('Wayne Gretzky', 'Gordie Howe', 'Bobby Orr', 'Phil Esposito', 'Johnny Bucyk', 'Ray Bourque')`,
  );
  check("six career checks found", careers.length === 6, String(careers.length));
  for (const r of careers) check(`${r.full_name}: ${r.lev} goals in the leverage table = ${r.box} official`, r.lev === r.box);
  const assists = await one(
    `select (select sum(assists) from player_leverage where player_id = 8447400 and game_type = 'regular')::int lev,
            (select sum(s.assists) from nhl_skater_games s join nhl_games g on g.id = s.game_id where s.player_id = 8447400 and g.game_type = 'regular' and s.played)::int box`,
  );
  check(`Gretzky's assists: ${assists.lev} = ${assists.box} official`, assists.lev === assists.box);

  // Cup Leverage, stored.
  const cupCover = await one(
    `select count(*) filter (where l.cup_home is null or l.cup_away is null)::int missing, count(*)::int n,
            count(*) filter (where (l.cup_home not between 0 and 1) or (l.cup_away not between 0 and 1))::int bad
     from leverage_games l join nhl_games g on g.id = l.game_id where g.game_type = 'playoff' and g.season >= '19261927'`,
  );
  check(`every playoff game since 1926-27 has a Cup chance for both sides (${cupCover.n} games), all within 0-1`, cupCover.missing === 0 && cupCover.bad === 0, JSON.stringify(cupCover));
  const early = await one(`select count(*)::int n from leverage_games l join nhl_games g on g.id = l.game_id where g.season < '19261927' and (l.cup_home is not null or l.cup_away is not null)`);
  check("no Cup chance before 1926-27 (the Cup was played against other leagues)", early.n === 0);
  const finals = await one(
    `select count(*)::int n, min(least(l.cup_home, l.cup_away))::float mn from leverage_games l join nhl_games g on g.id = l.game_id
     where g.game_type = 'playoff' and g.season >= '19261927' and (g.id / 100) % 10 = (select max((x.id / 100) % 10) from nhl_games x where x.season = g.season and x.game_type = 'playoff')`,
  );
  check(`every Final game (${finals.n}) is worth the whole Cup`, near(finals.mn, 1));
  const cupTop = await getBiggestGoals("cup", { bruins: false, limit: 5 });
  check("the two Game 7 overtime winners in Final history (Leswick 1954, Babando 1950) are in the top 5", ["Tony Leswick", "Pete Babando"].every((n) => cupTop.some((g) => g.scorer === n)), cupTop.map((g) => g.scorer).join(", "));
  const g11 = await one(
    `select min(rank)::int r from (select w.game_id, rank() over (order by (w.wp_after - w.wp_before) * w.stakes * case when e.team_id = g.home_team_id then l.cup_home else l.cup_away end desc nulls last)
     from goal_wpa w join nhl_goal_events e using (game_id, event_id) join nhl_games g on g.id = w.game_id join leverage_games l on l.game_id = w.game_id) x where game_id = 2010030417`,
  );
  check(`2011 Final Game 7: Bergeron's opener is near the top in Cup Leverage (#${g11.r})`, g11.r <= 100);

  // The pages' queries.
  const bos = await getBruinsLeverageLeaders("regular", "lg", 200);
  const bourque = bos.find((r) => r.name === "Ray Bourque");
  check("Bruins leaders count Boston goals only: Bourque 395 (not his 410 career)", bourque?.goals === 395, String(bourque?.goals));
  const esp = bos.find((r) => r.name === "Phil Esposito");
  check("...Esposito 459 for Boston (717 career)", esp?.goals === 459, String(esp?.goals));
  const card = await getClutchCard(8470638);
  check("Bergeron's card: 426 goals, best goal the 2013 G7 tier (+50% or more)", card?.regular?.goals === 426 && (card?.bestGoals[0]?.wpa ?? 0) > 0.5);
  const top = await getBruinsBiggestGoals("playoff", 1);
  check("Biggest Bruins playoff goal: Bergeron, 2013 Game 7 tying goal", top[0]?.scorer === "Patrice Bergeron" && top[0]?.gameId === 2012030147, JSON.stringify(top[0]));
  const seasons = await getLeverageSeasons();
  check("leaderboard seasons include 1917-18 and every Original Six season", seasons.includes("19171918") && ["19421943", "19501951", "19661967"].every((x) => seasons.includes(x)));

  await pool.end();
  console.log(`\n${failed === 0 ? "All passed." : `${failed} failed.`}`);
  process.exit(failed ? 1 : 0);
})();
