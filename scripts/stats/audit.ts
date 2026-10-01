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

  // 6. Coverage the later phases care about.
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
