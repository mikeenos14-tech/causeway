// Phase 0 data audit (spec section 4): assigns every nhl_games row its
// data-quality tier from what the game actually has, then prints, per
// season: games per tier, goal-event completeness, strength-flag coverage,
// shots coverage, and games whose goal events don't add up to the final
// score. Also checks the history against the site's own games table
// wherever both exist. Safe to re-run; it only rewrites tier fields.
//
// Usage: npx tsx --env-file=.env.local scripts/stats/audit.ts [--quiet]

import { Client } from "pg";

// A season's strength flags are real only if power-play goals actually
// appear: the feed labels every goal "ev" when it doesn't know.
const MIN_PP_SHARE = 0.03;

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // 1. Strength reliability per season, then tiers per game.
  await client.query(
    `with s as (
       select g.season, avg((e.strength in ('PP','SH'))::int) as pp_share
       from nhl_goal_events e join nhl_games g on g.id = e.game_id group by g.season)
     update nhl_games g set has_strength = coalesce(s.pp_share >= $1, false)
     from s where s.season = g.season`,
    [MIN_PP_SHARE],
  );
  await client.query(`update nhl_games set has_strength = false where has_strength is null`);
  await client.query(
    `update nhl_games set tier = case
       when home_score + away_score - (final_state = 'SO')::int > 0 and goals_with_time = 0 then 'D'
       when not goals_match_final or goals_with_time < home_score + away_score - (final_state = 'SO')::int then 'C'
       when has_strength and home_sog is not null and away_sog is not null and has_situation_codes and has_shot_events then 'A+'
       when has_strength and home_sog is not null and away_sog is not null then 'A'
       else 'B' end`,
  );

  // 2. Per-season report.
  const { rows } = await client.query(
    `select g.season,
            count(*)::int as games,
            count(*) filter (where tier = 'A+')::int as "A+",
            count(*) filter (where tier = 'A')::int as "A",
            count(*) filter (where tier = 'B')::int as "B",
            count(*) filter (where tier = 'C')::int as "C",
            count(*) filter (where tier = 'D')::int as "D",
            count(*) filter (where not goals_match_final)::int as mismatched,
            round(100.0 * count(*) filter (where home_sog is not null) / count(*))::int as sog_pct,
            bool_or(has_strength) as strength,
            (select round(100.0 * avg((e.empty_net is not null)::int))::int from nhl_goal_events e join nhl_games x on x.id = e.game_id where x.season = g.season) as en_known_pct,
            (select count(*)::int from nhl_penalty_events p join nhl_games x on x.id = p.game_id where x.season = g.season) as penalties
     from nhl_games g group by g.season order by g.season`,
  );
  if (!process.argv.includes("--quiet")) console.table(rows);

  // 3. Totals by tier and the earliest season each tier is the norm.
  const { rows: totals } = await client.query(`select tier, count(*)::int as games, min(season) as first_season from nhl_games group by tier order by tier`);
  console.table(totals);

  // 4. Mismatches worth a human look (goal events vs final score).
  const { rows: bad } = await client.query(
    `select g.id, g.season, g.game_date::text as date, ht.tri_code || ' ' || g.home_score || '-' || g.away_score || ' ' || at.tri_code as score, g.final_state,
            (select count(*) from nhl_goal_events e where e.game_id = g.id)::int as goal_events
     from nhl_games g join nhl_teams ht on ht.id = g.home_team_id join nhl_teams at on at.id = g.away_team_id
     where not g.goals_match_final order by g.id limit 15`,
  );
  console.log(`\nGames whose goal events don't add up to the final score (first 15 of ${(await client.query(`select count(*) from nhl_games where not goals_match_final`)).rows[0].count}):`);
  console.table(bad);

  // 5. Agreement with the site's own box-score games, where both exist.
  const { rows: cross } = await client.query(
    `select count(*)::int as both_tables,
            count(*) filter (where n.home_score <> g.home_score or n.away_score <> g.away_score)::int as score_differs,
            count(*) filter (where n.home_team_id <> g.home_team_id)::int as home_differs
     from nhl_games n join games g on g.id = n.id`,
  );
  console.log("\nAgreement with the site's games table:");
  console.table(cross);

  // 6. External reconciliation (docs/verification.md, layer 6): every
  // team-season's record and goals, computed from our game-by-game data,
  // against the NHL's own standings on the season's last regular-season
  // date. OT losses count as losses before 1999-2000 (no OTL column then);
  // the shootout winner's +1 is in GF/GA, as in the NHL's standings.
  const { rows: recon } = await client.query(
    `with last_day as (select season, max(game_date) as d from nhl_games where game_type = 'regular' group by season),
     ours as (
       select g.season, t.team,
              count(*)::int as gp,
              count(*) filter (where t.gf > t.ga)::int as w,
              count(*) filter (where t.gf < t.ga and (g.final_state = 'REG' or g.season < '19992000'))::int as l,
              count(*) filter (where t.gf < t.ga and g.final_state in ('OT','SO') and g.season >= '19992000')::int as otl,
              count(*) filter (where t.gf = t.ga)::int as ties,
              sum(t.gf)::int as gf, sum(t.ga)::int as ga
       from nhl_games g
       cross join lateral (values (g.home_team_id, g.home_score, g.away_score), (g.away_team_id, g.away_score, g.home_score)) t(team, gf, ga)
       where g.game_type = 'regular' group by g.season, t.team)
     select o.season, nt.tri_code, o.gp, s.games_played as nhl_gp, o.w, s.wins as nhl_w, o.l, s.losses as nhl_l,
            o.otl, s.ot_losses as nhl_otl, o.ties, s.ties as nhl_ties, o.gf, s.goals_for as nhl_gf, o.ga, s.goals_against as nhl_ga
     from ours o join last_day d on d.season = o.season
     join nhl_standings s on s.date = d.d and s.team_id = o.team
     join nhl_teams nt on nt.id = o.team
     where (o.gp, o.w, o.l, o.otl, o.ties, o.gf, o.ga) is distinct from (s.games_played, s.wins, s.losses, s.ot_losses, s.ties, s.goals_for, s.goals_against)
     order by o.season, nt.tri_code`,
  );
  const { rows: reconCount } = await client.query(
    `select count(*)::int as n from (select distinct s.season, s.team_id from nhl_standings s
       join (select season, max(game_date) as d from nhl_games where game_type = 'regular' group by season) l on l.season = s.season and l.d = s.date) x`,
  );
  console.log(`\nReconciliation vs NHL season-end standings: ${reconCount[0].n} team-seasons compared, ${recon.length} differ.`);
  if (recon.length) console.table(recon.slice(0, 25));

  // 7. Coverage the later phases care about.
  const { rows: other } = await client.query(
    `select (select count(*) from nhl_goal_events e where e.scorer_id is not null and not exists (select 1 from nhl_players p where p.id = e.scorer_id))::int as scorers_without_name,
            (select count(distinct venue_name) from nhl_games)::int as venues,
            (select count(*) from nhl_games where venue_name is null)::int as games_without_venue,
            (select count(*) from nhl_games where final_state = 'TIE')::int as ties`,
  );
  console.table(other);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
