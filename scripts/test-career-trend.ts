// Tests the player page's career-trend line (lib/career-trend.ts): rules
// on hand-built cases, then real players against the NHL's own per-season
// totals (games and points, or saves and shots against).
//
// Usage: npx tsx --env-file=.env.local scripts/test-career-trend.ts

import { buildCareerTrend, seasonByDate, MIN_GAMES } from "../lib/career-trend";
import { skaterPace, goaliePace, PACE_MIN_GAMES } from "../lib/pace";
import { getSkaterSeasonSplits, getGoalieSeasonSplits } from "../lib/player-detail-data";
import { pool } from "../lib/db";

// Known differences, each understood, with the fix that will remove it.
const KNOWN = new Map([
  // Came in for the shootout only (2015020493): 0:00 in the box score, so not
  // loaded, but the NHL credits a game played. Fix: credit shootout-only
  // goalies from play-by-play (with the stats-layer merge).
  ["8474593|20152016", "shootout-only appearance not yet credited (NHL 33 GP, ours 32)"],
]);

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

async function main() {
  // Rules
  const sk = [
    { season_id: "20192020", games: 70, points: 95 },
    { season_id: "20202021", games: 48, points: 48 },
    { season_id: "20212022", games: 3, points: 0 },
    { season_id: "20222023", games: 40, points: 30 }, // traded: two teams
    { season_id: "20222023", games: 42, points: 42 },
    { season_id: "20262027", games: 1, points: 2 },
  ];
  const t = buildCareerTrend(sk, false, "20262027");
  check("rate, not total: 48 pts in 48 GP is 1.00", near(t.points.find((p) => p.seasonId === "20202021")!.value, 1));
  check("seasons under 10 GP aren't charted", !t.points.some((p) => p.seasonId === "20212022"));
  check("trade season combined: 72 pts / 82 GP", near(t.points.find((p) => p.seasonId === "20222023")!.value, 72 / 82) && t.points.find((p) => p.seasonId === "20222023")!.games === 82);
  check("season in progress under 10 GP is held back as pending", !t.points.some((p) => p.seasonId === "20262027") && t.pending?.games === 1);
  const t2 = buildCareerTrend([...sk.slice(0, 2), { season_id: "20262027", games: MIN_GAMES, points: 9 }], false, "20262027");
  check("season in progress at 10 GP is charted and marked in progress", t2.points.at(-1)?.seasonId === "20262027" && t2.points.at(-1)!.inProgress && t2.pending === null);
  const t3 = buildCareerTrend([{ season_id: "20252026", games: 5, points: 1 }, ...sk.slice(0, 2)], false, null);
  check("a finished short season is simply left out, not pending", t3.pending === null && t3.points.length === 2);
  const g = buildCareerTrend(
    [
      { season_id: "20242025", games: 30, saves: 900, shots_against: 1000 },
      { season_id: "20242025", games: 10, saves: 290, shots_against: 300 },
    ],
    true,
    null,
  );
  check("goalie trade season: save % weighted by shots (1190/1300)", near(g.points[0].value, 1190 / 1300));
  check("seasonByDate: Oct 2026 is 2026-27, Mar 2027 too, Aug 2027 is 2026-27", seasonByDate(new Date("2026-10-01")) === "20262027" && seasonByDate(new Date("2027-03-01")) === "20262027" && seasonByDate(new Date("2027-08-31")) === "20262027" && seasonByDate(new Date("2027-09-01")) === "20272028");

  // On-pace line (lib/pace.ts)
  const sp = skaterPace({ gp: 30, goals: 20, points: 40, teamGamesPlayed: 35, seasonGames: 84 });
  check("pace: 20 G in 30 GP, team 35 of 84 played -> 53 goals (not 56)", sp?.paceGoals === 53 && sp.remaining === 49, JSON.stringify(sp));
  check("pace: points the same way -> 40 + 1.333 x 49 = 105", sp?.pacePoints === 105);
  check(`pace: hidden under ${PACE_MIN_GAMES} GP`, skaterPace({ gp: PACE_MIN_GAMES - 1, goals: 10, points: 20, teamGamesPlayed: 19, seasonGames: 84 }) === null);
  const done = skaterPace({ gp: 82, goals: 47, points: 110, teamGamesPlayed: 84, seasonGames: 84 });
  check("pace: no games left -> pace equals his actual totals", done?.paceGoals === 47 && done.pacePoints === 110 && done.remaining === 0);
  const gpace = goaliePace({ gp: 25, wins: 15, teamGamesPlayed: 40, seasonGames: 84 });
  check("goalie pace: wins per team game (15/40) x 44 left + 15 -> 32", gpace?.paceWins === 32, JSON.stringify(gpace));

  // Real players vs the NHL: every charted season's inputs
  const { rows: picks } = await pool.query(
    `(select player_id, false as goalie from skater_game_stats s join games g on g.id = s.game_id where g.game_type = 'regular' group by player_id having min(g.season_id) >= '20082009' and count(*) > 200 order by md5(player_id::text) limit 20)
     union all
     (select player_id, true from goalie_game_stats s join games g on g.id = s.game_id where g.game_type = 'regular' group by player_id having min(g.season_id) >= '20082009' and count(*) > 100 order by md5(player_id::text) limit 5)`,
  );
  picks.push({ player_id: 8477956, goalie: false }); // Pastrnak
  let seasons = 0, diffs = 0;
  for (const p of picks) {
    const id = Number(p.player_id);
    const splits = p.goalie ? await getGoalieSeasonSplits(id) : await getSkaterSeasonSplits(id);
    const trend = buildCareerTrend(splits, p.goalie, null);
    const land = await fetch(`https://api-web.nhle.com/v1/player/${id}/landing`).then((r) => r.json());
    const nhl = new Map<string, { gp: number; pts: number; sv: number; sa: number }>();
    for (const s of land.seasonTotals ?? []) {
      if (s.leagueAbbrev !== "NHL" || s.gameTypeId !== 2) continue;
      const k = String(s.season), e = nhl.get(k) ?? { gp: 0, pts: 0, sv: 0, sa: 0 };
      e.gp += s.gamesPlayed ?? 0;
      e.pts += s.points ?? 0;
      // Saves from the NHL's own save % (a goal can go in without a
      // recorded shot, so shots minus goals isn't saves).
      e.sa += s.shotsAgainst ?? 0;
      e.sv += Math.round((s.savePctg ?? 0) * (s.shotsAgainst ?? 0));
      nhl.set(k, e);
    }
    for (const pt of trend.points) {
      seasons++;
      const n = nhl.get(pt.seasonId);
      const want = n ? (p.goalie ? n.sv / n.sa : n.pts / n.gp) : NaN;
      const known = KNOWN.get(`${id}|${pt.seasonId}`);
      if (known) {
        console.log(`  known: ${land.firstName.default} ${land.lastName.default} ${pt.seasonId}: ${known}`);
        continue;
      }
      if (!n || n.gp !== pt.games || Math.abs(want - pt.value) > 1e-9) {
        diffs++;
        console.log(`  DIFF ${land.firstName.default} ${land.lastName.default} ${pt.seasonId}: ours ${pt.value.toFixed(4)} (${pt.games} GP), NHL ${n ? want.toFixed(4) : "none"} (${n?.gp} GP)`);
      }
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  check(`${picks.length} real players: every charted season matches the NHL (${seasons} seasons)`, diffs === 0, `${diffs} differences`);
  const past = buildCareerTrend(await getSkaterSeasonSplits(8477956), false, null).points.find((x) => x.seasonId === "20202021");
  check("Pastrnak 2020-21 charts as 1.00 pts/game (48 in 48), not a slump", !!past && near(past.value, 1) && past.games === 48, JSON.stringify(past));

  await pool.end();
  console.log(`\n${failed === 0 ? "All passed." : `${failed} failed.`}`);
  process.exit(failed ? 1 : 0);
}

main();
