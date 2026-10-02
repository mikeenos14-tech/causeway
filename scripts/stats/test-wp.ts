// Tests the win probability model (lib/stats/wp.ts with the stored params
// and table): arithmetic, monotonicity everywhere, era rules, agreement with
// the pregame Elo odds, and the spec's smell test (2013 Game 7 vs Toronto).
//
// Usage: npx tsx --env-file=.env.local scripts/stats/test-wp.ts

import { pool } from "../../lib/db";
import { getWpModel } from "../../lib/wp-model";
import { getGameWpTimeline } from "../../lib/wp-game";
import { regulationOutcome, winProbability, type WpState } from "../../lib/stats/wp";
import { winChance } from "../../lib/elo-odds";
import { ERAS, eraOf, otFormat } from "../../config/stats";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
};

(async () => {
  const m = (await getWpModel())!;
  check("model loaded with its correction table", !!m && m.table.size > 5000, String(m?.table.size));

  const r = regulationOutcome(0, 1.5, 1.5);
  check("regulation outcome sums to 1, even match is symmetric", Math.abs(r.win + r.tie + r.loss - 1) < 1e-12 && Math.abs(r.win - r.loss) < 1e-12);
  check("a 2-goal lead with no time left is a sure thing", regulationOutcome(2, 0, 0).win === 1);

  const seasonFor = (era: string) => ERAS.find((e) => e.id === era)!.from;
  const st = (era: string, playoff: boolean, elapsed: number, h: number, a: number, gap = 0): WpState => ({ era, otRule: otFormat(seasonFor(era)).label, playoff, elapsed, inOvertime: false, homeScore: h, awayScore: a, gap });
  const wp = (s: WpState) => winProbability(s, m.params, m.table);

  // Monotone in margin: every era, regular and playoff, every minute.
  let marginBad = 0, timeBad = 0, sumBad = 0, checks = 0;
  for (const era of ERAS.map((e) => e.id))
    for (const playoff of [false, true])
      for (let t = 0; t < 3600; t += 60) {
        let prev = -1;
        for (let d = -5; d <= 5; d++) {
          const o = wp(st(era, playoff, t, Math.max(0, d), Math.max(0, -d)));
          checks++;
          if (o.win < prev - 1e-9) marginBad++;
          if (Math.abs(o.win + o.tie + o.loss - 1) > 1e-9 || o.win < 0 || o.loss < 0 || o.tie < 0) sumBad++;
          prev = o.win;
        }
        // A lead held longer is worth more; a deficit, less.
        // (From minute 1: a lead at 0:00 is impossible, and that state has
        // no correction cell to compare against.)
        if (t > 60)
          for (const d of [1, 2, 3]) {
            const now = wp(st(era, playoff, t, d, 0)).win, before = wp(st(era, playoff, t - 60, d, 0)).win;
            const nowT = wp(st(era, playoff, t, 0, d)).win, beforeT = wp(st(era, playoff, t - 60, 0, d)).win;
            if (now < before - 0.005 || nowT > beforeT + 0.005) timeBad++;
          }
      }
  check(`a bigger lead never lowers the win chance (${checks} states)`, marginBad === 0, `${marginBad} violations`);
  check("win + tie + loss = 1, nothing negative, everywhere", sumBad === 0, `${sumBad} bad`);
  check("holding a lead longer never lowers it (0.5-point tolerance per minute)", timeBad === 0, `${timeBad} violations`);

  check("no ties possible from 2005-06 on", wp(st("modern", false, 1800, 2, 2)).tie === 0 && wp(st("cap-shootout", false, 3540, 1, 1)).tie === 0);
  check("no ties in the playoffs, any era", wp(st("original-six", true, 3540, 1, 1)).tie === 0);
  const t1970 = wp(st("expansion", false, 3540, 3, 3));
  check("1970s: tied with a minute left is most likely a tie (no overtime then)", t1970.tie > 0.8, JSON.stringify(t1970));
  check("final whistle: a lead is a win", wp({ ...st("modern", false, 3600, 3, 2) }).win === 1);
  check("overtime, playoffs: tied means the stronger team is favored to score next", wp({ ...st("modern", true, 3600, 2, 2, 100), inOvertime: true }).win > 0.5);

  // Pregame: the 0:00 chance agrees with the Elo odds (both from the same gap).
  const { rows: games } = await pool.query(
    `select g.season, h.rating_before::float rh, a.rating_before::float ra from nhl_games g join nhl_teams ht on ht.id=g.home_team_id join nhl_teams at on at.id=g.away_team_id
     join elo_history h on h.game_id=g.id and h.franchise_id=ht.lineage_id join elo_history a on a.game_id=g.id and a.franchise_id=at.lineage_id
     where g.season='20242025' and g.game_type='regular' order by md5(g.id::text) limit 300`,
  );
  let worst = 0;
  for (const g of games) {
    const pre = wp({ era: eraOf(g.season).id, otRule: otFormat(g.season).label, playoff: false, elapsed: 0, inOvertime: false, homeScore: 0, awayScore: 0, gap: g.rh - g.ra }).win;
    worst = Math.max(worst, Math.abs(pre - winChance(g.rh, g.ra, g.season)));
  }
  check("puck drop: win probability within 3 points of the pregame Elo odds (300 games)", worst < 0.03, `worst ${(100 * worst).toFixed(1)} points`);

  // Spec smell test: 2013 R1 G7, Toronto up 4-1 on Boston with 10:42 left.
  const g7 = await getGameWpTimeline(2012030147);
  const at = (t: number) => g7!.points.filter((x) => x.t <= t).at(-1)!.p;
  check("2013 Game 7: Boston below 3% down 4-1 with 10:42 left", !!g7 && at(2957) < 0.03, g7 ? String(at(2957)) : "no timeline");
  check("2013 Game 7: Bergeron's tying goal is the biggest swing", g7?.biggestSwing?.scorer === "Patrice Bergeron");
  check("2013 Game 7: the curve ends at 100% (Boston won)", g7?.points.at(-1)?.p === 1);
  const orr = await getGameWpTimeline(1969030314);
  check("Orr's 1970 goal: overtime starts near even, ends at 100%", !!orr && orr.points.at(-1)!.p === 1 && Math.abs(orr.points.filter((x) => x.t <= 3600).at(-1)!.p - 0.5) < 0.2);

  await pool.end();
  console.log(`\n${failed === 0 ? "All passed." : `${failed} failed.`}`);
  process.exit(failed ? 1 : 0);
})();
