// Independent check of the stored Elo (docs/verification.md, layer 2):
// plain SQL that shares no code with lib/stats/elo.ts recomputes what the
// engine stored and must agree with it.
//   - every expectation, from the stored pre-game ratings and the era's
//     home ice: E = 1 / (1 + 10^(-(Rh + H - Ra) / 400))
//   - zero-sum: each game's two rating changes cancel
//   - each stored result agrees with the actual final score
//   - two rows per game, every game once
//   - the league mean at each season's end stays within 5 of 1505
//
// Usage: npx tsx --env-file=.env.local scripts/stats/verify-elo-sql.ts

import { Client } from "pg";
import { ELO, ERAS } from "../../config/stats";

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let failed = 0;
  const check = (name: string, ok: boolean, detail: string) => {
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  };

  const eraCase = `case ${ERAS.map((e) => `when g.season between '${e.from}' and '${e.to}' then ${ELO.params.homeIce[e.id]}`).join(" ")} end`;
  const { rows: [exp] } = await client.query(
    `with pair as (
       select h.game_id, h.rating_before as rh, a.rating_before as ra, h.expected as stored, ${eraCase} as hi,
              -- back-to-back penalty, straight from team_rest (not the engine's loader)
              coalesce((select ${ELO.params.b2bPenalty ?? 0} from team_rest r where r.game_id = g.id and r.is_home and r.back_to_back), 0) as pen_h,
              coalesce((select ${ELO.params.b2bPenalty ?? 0} from team_rest r where r.game_id = g.id and not r.is_home and r.back_to_back), 0) as pen_a
       from elo_history h join elo_history a on a.game_id = h.game_id and a.franchise_id <> h.franchise_id
       join nhl_games g on g.id = h.game_id join nhl_teams ht on ht.id = g.home_team_id
       where h.franchise_id = ht.lineage_id)
     select count(*)::int as n, max(abs(stored - 1 / (1 + power(10, -((rh - pen_h) + hi - (ra - pen_a)) / 400.0))))::float as worst from pair`,
  );
  check("expectations recomputed in SQL match the engine", exp.worst < 1e-9, `${exp.n} games, largest difference ${exp.worst}`);

  // Every rating change recomputed: K (playoff or regular) x margin
  // multiplier (regulation only; the winner's empty-net goals left out where
  // known, 2009-10 on) x (result - expected). The engine's early-season K
  // option is off in config; if it's ever turned on, this check must learn it.
  const { rows: [dl] } = await client.query(
    `with g2 as (
       select g.id, g.game_type, g.final_state, g.home_score, g.away_score, g.season,
              case when g.season >= '20092010' then coalesce((select count(*) from nhl_goal_events e where e.game_id = g.id and e.empty_net and e.team_id = case when g.home_score > g.away_score then g.home_team_id else g.away_team_id end), 0) else 0 end as en
       from nhl_games g),
     d as (
       select h.game_id, (h.rating_after - h.rating_before) as delta, h.result, h.expected,
              case when g2.game_type = 'playoff' then ${ELO.params.kPlayoff} else ${ELO.params.kRegular} end as k,
              case when g2.final_state <> 'REG' or g2.home_score = g2.away_score then 1
                   else 1 + ${ELO.params.marginCoef} * ln(greatest(1, abs(g2.home_score - g2.away_score) - ${ELO.params.marginExcludesEmptyNet ? "g2.en" : "0"})) end as m
       from elo_history h join g2 on g2.id = h.game_id join nhl_teams ht on ht.id = (select home_team_id from nhl_games where id = g2.id)
       where h.franchise_id = ht.lineage_id)
     select count(*)::int as n, max(abs(delta - k * m * (result - expected)))::float as worst from d`,
  );
  check("rating changes recomputed in SQL (K x margin incl. empty-net rule x surprise)", dl.worst < 1e-9, `${dl.n} games, largest difference ${dl.worst}`);

  const { rows: [zero] } = await client.query(
    `select max(abs(s))::float as worst from (select sum(rating_after - rating_before) as s from elo_history group by game_id) x`,
  );
  check("every game's rating changes cancel (zero-sum)", zero.worst < 1e-9, `largest leftover ${zero.worst}`);

  const { rows: [res] } = await client.query(
    `select count(*)::int as wrong from elo_history h join nhl_games g on g.id = h.game_id join nhl_teams ht on ht.id = g.home_team_id
     where h.franchise_id = ht.lineage_id and not (
       (g.home_score = g.away_score and h.result = 0.5) or
       (g.home_score > g.away_score and g.final_state = 'REG' and h.result = 1) or
       (g.home_score < g.away_score and g.final_state = 'REG' and h.result = 0) or
       (g.home_score > g.away_score and g.final_state in ('OT','SO') and h.result = $1) or
       (g.home_score < g.away_score and g.final_state in ('OT','SO') and h.result = 1 - $1::numeric))`,
    [ELO.params.otWinnerScore],
  );
  check("every stored result matches the final score", res.wrong === 0, `${res.wrong} disagree`);

  const { rows: [cov] } = await client.query(
    `select (select count(*) from elo_history)::int as rows, (select count(distinct game_id) from elo_history)::int as games,
            (select count(*) from nhl_games where not (id = any($1)))::int as expected_games`,
    [ELO.excludeGameIds],
  );
  check("two rows per game, every game once", cov.rows === 2 * cov.games && cov.games === cov.expected_games, `${cov.rows} rows, ${cov.games} games, ${cov.expected_games} expected`);

  const { rows: means } = await client.query(
    `with last as (
       select distinct on (e.franchise_id, g.season) g.season, e.rating_after
       from elo_history e join nhl_games g on g.id = e.game_id order by e.franchise_id, g.season, g.game_date desc, g.id desc)
     select season, avg(rating_after)::float as mean from last group by season`,
  );
  const worst = means.reduce((w, m) => (Math.abs(m.mean - 1505) > Math.abs(w.mean - 1505) ? m : w), means[0]);
  check("league mean at each season's end within 5 of 1505", Math.abs(worst.mean - 1505) <= 5, `${means.length} seasons, worst ${worst.season} at ${worst.mean.toFixed(2)}`);

  await client.end();
  console.log(`\n${failed === 0 ? "All passed." : `${failed} failed.`}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
