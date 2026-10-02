// Tests the pregame Elo win chance (lib/elo-odds.ts, config ELO.winProb).
// Usage: npx tsx --env-file=.env.local scripts/test-elo-odds.ts

import { winChance, getEloOdds } from "../lib/elo-odds";
import { ELO } from "../config/stats";
import { pool } from "../lib/db";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
};

(async () => {
  const even = winChance(1500, 1500, "20262027");
  const expectEven = 1 / (1 + Math.exp(-(ELO.winProb.intercept + ELO.winProb.slope * ELO.params.homeIce.modern)));
  check("equal ratings: home team edge from home ice only (~54%)", Math.abs(even - expectEven) < 1e-12 && even > 0.52 && even < 0.56, String(even));
  check("a stronger home team is more likely to win", winChance(1600, 1500, "20262027") > even);
  check("a stronger road team flips it", winChance(1400, 1500, "20262027") < 0.5);
  check("home ice follows the era (dead-puck 30 > modern 20)", winChance(1500, 1500, "19971998") > even);
  check("chances stay inside (0, 1)", winChance(2000, 1000, "20262027") < 1 && winChance(1000, 2000, "20262027") > 0);
  const o = await getEloOdds(6, 52, "20262027", 2);
  check("odds for a real game: both sides sum to 1", !!o && Math.abs(o.home + o.away - 1) < 1e-12, JSON.stringify(o));
  check("whole percentages sum to 100 (away = 100 - home)", !!o && Math.round(o.home * 100) + (100 - Math.round(o.home * 100)) === 100);
  check("no odds for playoff games (curve fitted on regular season)", (await getEloOdds(6, 52, "20262027", 3)) === null);
  check("no odds for an unknown team", (await getEloOdds(6, 999999, "20262027", 2)) === null);
  // Back-to-backs: the pregame check (did a team play the day before?)
  // must agree with team_rest's flags on real games.
  check("a back-to-back lowers that team's chance", winChance(1500, 1500, "20262027", { home: true, away: false }) < even && winChance(1500, 1500, "20262027", { home: false, away: true }) > even);
  const { rows: sample } = await pool.query(
    `select g.id, g.season, g.home_team_id, g.away_team_id, g.start_time_utc::text as start,
            bool_or(r.is_home and r.back_to_back) as b2b_h, bool_or(not r.is_home and r.back_to_back) as b2b_a
     from nhl_games g join team_rest r on r.game_id = g.id
     where g.season = '20252026' and g.game_type = 'regular' and g.start_time_utc is not null
     group by g.id order by md5(g.id::text) limit 60`,
  );
  let agree = 0, withB2b = 0;
  for (const g of sample) {
    const o = await getEloOdds(Number(g.away_team_id), Number(g.home_team_id), g.season, 2, g.start);
    if (o && o.b2b.home === g.b2b_h && o.b2b.away === g.b2b_a) agree++;
    if (g.b2b_h || g.b2b_a) withB2b++;
  }
  check(`pregame back-to-back check agrees with team_rest on 60 real games (${withB2b} with a back-to-back)`, agree === sample.length && withB2b > 0, `${agree}/${sample.length}`);
  await pool.end();
  console.log(`\n${failed === 0 ? "All passed." : `${failed} failed.`}`);
  process.exit(failed ? 1 : 0);
})();
