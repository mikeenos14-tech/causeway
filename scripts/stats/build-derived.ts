// Rebuilds the Phase 0 derived tables from the nhl_* history (spec
// section 4): season_context, game_state_snapshots, team_rest. Each is
// rebuilt from scratch, so it's deterministic and safe to re-run after any
// backfill or parser change.
//
// Usage: npx tsx --env-file=.env.local scripts/stats/build-derived.ts

import { Client } from "pg";
import { insertRows } from "../../lib/stats/store-games";
import { otFormat, DERIVED_MODEL_VERSION as V } from "../../config/stats";

const CHECKPOINTS: [string, number][] = [["P1", 1200], ["P2", 2400], ["45:00", 2700], ["50:00", 3000], ["55:00", 3300]];

async function seasonContext(client: Client) {
  const { rows } = await client.query(
    `select g.season,
            count(distinct t.team)::int as teams,
            count(distinct g.id)::int as games,
            sum(g.home_score + g.away_score - (g.final_state = 'SO')::int) filter (where t.is_home)::numeric as goals,
            avg((g.home_sog is not null and g.away_sog is not null)::int) filter (where t.is_home) as shots_coverage,
            avg(g.home_sog + g.away_sog) filter (where t.is_home and g.home_sog is not null) as shots_per_game,
            (select coalesce(sum(p.minutes), 0) from nhl_penalty_events p join nhl_games x on x.id = p.game_id where x.season = g.season and x.game_type = 'regular')::numeric as pim
     from nhl_games g
     cross join lateral (values (g.home_team_id, true), (g.away_team_id, false)) t(team, is_home)
     where g.game_type = 'regular'
     group by g.season order by g.season`,
  );
  await client.query("delete from season_context");
  await insertRows(
    client,
    "season_context",
    ["season", "teams", "games", "games_per_team", "goals_per_team_game", "shots_per_team_game", "shots_coverage", "pim_per_team_game", "ot_format", "shootout", "ties_possible", "model_version"],
    rows.map((r) => {
      const ot = otFormat(r.season);
      const coverage = Number(r.shots_coverage);
      return [r.season, r.teams, r.games, (2 * r.games) / r.teams, Number(r.goals) / (2 * r.games), coverage >= 0.9 ? Number(r.shots_per_game) / 2 : null, coverage, Number(r.pim) / (2 * r.games), ot.label, ot.shootout, ot.tiesPossible, V];
    }),
  );
  console.log(`season_context: ${rows.length} seasons`);
}

async function snapshots(client: Client) {
  const { rows: games } = await client.query(`select id, home_team_id, away_team_id, final_state, ot_periods from nhl_games`);
  const { rows: goals } = await client.query(`select game_id, team_id, time_elapsed_sec from nhl_goal_events`);
  const { rows: pens } = await client.query(`select game_id, team_id, minutes, time_elapsed_sec from nhl_penalty_events where minutes is not null`);
  const { rows: periods } = await client.query(`select game_id, period, home_shots, away_shots from nhl_period_scores where period <= 2 and home_shots is not null`);
  const group = <T extends { game_id: number }>(xs: T[]) => {
    const m = new Map<number, T[]>();
    for (const x of xs) m.set(x.game_id, [...(m.get(x.game_id) ?? []), x]);
    return m;
  };
  const goalsBy = group(goals);
  const pensBy = group(pens);
  const periodsBy = group(periods);

  const out: unknown[][] = [];
  for (const g of games) {
    const gs = goalsBy.get(g.id) ?? [];
    const ps = pensBy.get(g.id) ?? [];
    const per = periodsBy.get(g.id) ?? [];
    const points = [...CHECKPOINTS];
    if (g.final_state === "OT" || g.final_state === "SO" || g.ot_periods > 0) points.push(["OT", 3600]);
    for (const [name, t] of points) {
      const count = (team: number, from: number) => gs.filter((x) => x.team_id === team && x.time_elapsed_sec <= t && x.time_elapsed_sec > from).length;
      const pim = (team: number) => ps.filter((x) => x.team_id === team && x.time_elapsed_sec <= t).reduce((s, x) => s + x.minutes, 0);
      // Shots only where they're exact: through the end of a period.
      const shotPeriods = name === "P1" ? [1] : name === "P2" ? [1, 2] : null;
      const shots = shotPeriods && shotPeriods.every((n) => per.some((x) => x.period === n))
        ? [per.filter((x) => shotPeriods.includes(x.period)).reduce((s, x) => s + x.home_shots, 0), per.filter((x) => shotPeriods.includes(x.period)).reduce((s, x) => s + x.away_shots, 0)]
        : [null, null];
      out.push([g.id, name, t, count(g.home_team_id, -1), count(g.away_team_id, -1), shots[0], shots[1], ps.length ? pim(g.home_team_id) : null, ps.length ? pim(g.away_team_id) : null, count(g.home_team_id, t - 600), count(g.away_team_id, t - 600), V]);
    }
  }
  await client.query("delete from game_state_snapshots");
  await insertRows(client, "game_state_snapshots", ["game_id", "checkpoint", "elapsed_sec", "home_goals", "away_goals", "home_shots", "away_shots", "home_pim", "away_pim", "home_goals_last10", "away_goals_last10", "model_version"], out);
  console.log(`game_state_snapshots: ${out.length} rows for ${games.length} games`);
}

async function teamRest(client: Client) {
  const { rows } = await client.query(
    `select id, season, game_date::text as d, home_team_id as team, true as is_home from nhl_games
     union all select id, season, game_date::text, away_team_id, false from nhl_games
     order by team, d, id`,
  );
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  const out: unknown[][] = [];
  let i = 0;
  while (i < rows.length) {
    let j = i;
    while (j < rows.length && rows[j].team === rows[i].team) j++;
    const games = rows.slice(i, j);
    let roadStreak = 0;
    for (let k = 0; k < games.length; k++) {
      const g = games[k];
      const prev = k > 0 && games[k - 1].season === g.season ? games[k - 1] : null;
      const today = day(g.d);
      const within = (n: number) => games.slice(Math.max(0, k - 10), k).filter((x) => x.season === g.season && today - day(x.d) >= 1 && today - day(x.d) <= n).length;
      const priorRoad = roadStreak;
      roadStreak = g.is_home ? 0 : prev ? roadStreak + 1 : 1;
      const daysRest = prev ? today - day(prev.d) : null;
      out.push([g.id, g.team, g.is_home, daysRest, daysRest === 1, within(4), within(7), g.is_home ? 0 : roadStreak, g.is_home && priorRoad >= 4, null, null, null, V]);
    }
    i = j;
  }
  await client.query("delete from team_rest");
  await insertRows(client, "team_rest", ["game_id", "team_id", "is_home", "days_rest", "back_to_back", "games_last4", "games_last7", "road_trip_len", "homestand_return", "miles_from_prev", "miles_last7", "tz_crossed", "model_version"], out);
  console.log(`team_rest: ${out.length} rows`);
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await seasonContext(client);
  await snapshots(client);
  await teamRest(client);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
