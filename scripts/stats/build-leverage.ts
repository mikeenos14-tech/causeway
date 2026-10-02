// Builds Leverage Goals (spec section 8) from the stored win probability
// model: every goal's WPA in every game since 1917 whose goal list adds up
// to the final score, playoff stakes per game, the per-game reconciliation
// (pregame + goals + clock = final), and player totals per season.
// Rebuilt from scratch daily, after Elo and win probability.
//
// Usage: npx tsx --env-file=.env.local scripts/stats/build-leverage.ts [--dry-run]

import { Client } from "pg";
import { insertRows } from "../../lib/stats/store-games";
import { getWpModel } from "../../lib/wp-model";
import { pool } from "../../lib/db";
import { wpContext, finishedGameEnd } from "../../lib/wp-curve";
import { gameLeverage, gameStakes, neutralGameChance, seriesFormat, formatLabel, GARBAGE_WPA, ASSIST_SHARE, type SeriesGame } from "../../lib/stats/leverage";
import { ELO } from "../../config/stats";

async function main() {
  const dry = process.argv.includes("--dry-run");
  const model = await getWpModel();
  if (!model) throw new Error("No win probability model stored; run build-wp first.");
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const { rows: games } = await c.query(
    `select g.id, g.season, g.game_type, g.home_team_id, g.away_team_id, g.home_score, g.away_score, g.final_state,
            h.rating_before::float rh, a.rating_before::float ra,
            coalesce((select bool_or(back_to_back) from team_rest r where r.game_id = g.id and r.is_home), false) b2b_h,
            coalesce((select bool_or(back_to_back) from team_rest r where r.game_id = g.id and not r.is_home), false) b2b_a
     from nhl_games g join nhl_teams ht on ht.id = g.home_team_id join nhl_teams at on at.id = g.away_team_id
     join elo_history h on h.game_id = g.id and h.franchise_id = ht.lineage_id
     join elo_history a on a.game_id = g.id and a.franchise_id = at.lineage_id
     where g.game_type in ('regular', 'playoff')
     order by g.id`,
  );
  const { rows: goalRows } = await c.query(`select game_id, event_id, time_elapsed_sec, team_id from nhl_goal_events order by game_id, time_elapsed_sec, event_id`);
  const goalsBy = new Map<number, typeof goalRows>();
  for (const r of goalRows) {
    const k = Number(r.game_id);
    if (!goalsBy.has(k)) goalsBy.set(k, []);
    goalsBy.get(k)!.push(r);
  }

  // Playoff stakes, series by series (season, round and series digits of the id).
  const stakesBy = new Map<number, { stakes: number | null; format: string }>();
  const series = new Map<string, typeof games>();
  for (const g of games.filter((x) => x.game_type === "playoff")) {
    const k = `${g.season}|${Math.floor(g.id / 100) % 10}|${Math.floor(g.id / 10) % 10}`;
    if (!series.has(k)) series.set(k, []);
    series.get(k)!.push(g);
  }
  const maxRound = new Map<string, number>();
  for (const g of games.filter((x) => x.game_type === "playoff")) maxRound.set(g.season, Math.max(maxRound.get(g.season) ?? 0, Math.floor(g.id / 100) % 10));
  const formats = { "best-of": 0, "total-goals": 0, irregular: 0 };
  for (const gs of series.values()) {
    gs.sort((x, y) => x.id - y.id);
    const A = gs[0].home_team_id;
    const fromA = gs.map((g): SeriesGame => (g.home_team_id === A ? { id: g.id, teamA: A, aScore: g.home_score, bScore: g.away_score } : { id: g.id, teamA: A, aScore: g.away_score, bScore: g.home_score }));
    const finalRound = maxRound.get(gs[0].season)!;
    const f = seriesFormat(gs[0].season, fromA, Math.floor(gs[0].id / 100) % 10 === finalRound);
    formats[f.kind]++;
    let aw = 0, bw = 0;
    gs.forEach((g, i) => {
      let stakes: number | null = null;
      if (f.kind === "best-of") {
        // A's rating, whichever side A is on tonight.
        const ra = g.home_team_id === A ? g.rh : g.ra, rb = g.home_team_id === A ? g.ra : g.rh;
        stakes = gameStakes(aw, bw, f.need, neutralGameChance(ra, rb));
      }
      stakesBy.set(g.id, { stakes, format: formatLabel(f) });
      if (fromA[i].aScore > fromA[i].bScore) aw++;
      else if (fromA[i].aScore < fromA[i].bScore) bw++;
    });
  }
  console.log(`${series.size} playoff series: ${formats["best-of"]} best-of-N, ${formats["total-goals"]} total-goals (no stakes), ${formats.irregular} irregular (no stakes).`);

  const pen = ELO.params.b2bPenalty ?? 0;
  const goalOut: unknown[][] = [];
  const gameOut: unknown[][] = [];
  let skipped = 0, worstRecon = 0;
  for (const g of games) {
    const goals = goalsBy.get(g.id) ?? [];
    const extra = g.final_state === "SO" ? 1 : 0;
    if (goals.length + extra !== g.home_score + g.away_score) {
      skipped++;
      continue;
    }
    const playoff = g.game_type === "playoff";
    const ctx = wpContext(model, g.season, playoff, g.rh - (g.b2b_h ? pen : 0) - (g.ra - (g.b2b_a ? pen : 0)));
    const gin = goals.map((x) => ({ eventId: x.event_id, t: Number(x.time_elapsed_sec), home: Number(x.team_id) === Number(g.home_team_id) }));
    const end = finishedGameEnd(ctx, g.final_state, gin.map((x) => x.t));
    const final = g.home_score > g.away_score ? 1 : g.home_score < g.away_score ? 0 : 0.5;
    const L = gameLeverage(ctx, gin, end, final);
    worstRecon = Math.max(worstRecon, Math.abs(L.pregame + L.goalWpaHome + L.drift - L.final));
    const st = playoff ? stakesBy.get(g.id) : undefined;
    for (const x of L.goals) goalOut.push([g.id, x.eventId, x.before, x.after, st?.stakes ?? null]);
    gameOut.push([g.id, L.pregame, L.final, L.goalWpaHome, L.drift, st?.stakes ?? null, st?.format ?? null, model.version]);
  }
  console.log(`${gameOut.length} games scored, ${goalOut.length} goals; ${skipped} skipped (goal list short of the score). Worst reconciliation: ${worstRecon.toExponential(2)}.`);
  if (worstRecon > 1e-9) throw new Error("Goals + clock drift don't reconcile to the result; not storing.");

  if (!dry) {
    await c.query("begin");
    await c.query("delete from player_leverage");
    await c.query("delete from goal_wpa");
    await c.query("delete from leverage_games");
    await insertRows(c, "leverage_games", ["game_id", "pregame", "final", "goal_wpa", "drift", "stakes", "series_format", "model_version"], gameOut);
    await insertRows(c, "goal_wpa", ["game_id", "event_id", "wp_before", "wp_after", "stakes"], goalOut);
    // Player totals: goals by the scorer, assist credit by the assisters.
    await c.query(
      `insert into player_leverage (player_id, season, game_type, goals, lg, garbage_goals, assists, assist_lg, playoff_lg)
       select player_id, season, game_type, sum(goals)::int, sum(lg), sum(garbage)::int, sum(assists)::int, sum(assist_lg),
              case when game_type = 'playoff' then sum(playoff_lg) end
       from (
         select e.scorer_id player_id, g.season, g.game_type, 1 goals, (w.wp_after - w.wp_before) lg,
                ((w.wp_after - w.wp_before) < $1)::int garbage, 0 assists, 0::real assist_lg, (w.wp_after - w.wp_before) * w.stakes playoff_lg
         from goal_wpa w join nhl_goal_events e using (game_id, event_id) join nhl_games g on g.id = w.game_id where e.scorer_id is not null
         union all
         select x.player_id, g.season, g.game_type, 0, 0, 0, 1, (w.wp_after - w.wp_before) * x.share, null
         from goal_wpa w join nhl_goal_events e using (game_id, event_id) join nhl_games g on g.id = w.game_id
         cross join lateral (values (e.assist1_id, $2::real), (e.assist2_id, $3::real)) x(player_id, share)
         where x.player_id is not null
       ) t group by player_id, season, game_type`,
      [GARBAGE_WPA, ASSIST_SHARE.primary, ASSIST_SHARE.secondary],
    );
    await c.query("commit");
    const { rows: [n] } = await c.query(`select count(*)::int n from player_leverage`);
    console.log(`Stored ${gameOut.length} games, ${goalOut.length} goals, ${n.n} player-seasons (${model.version}).`);
  }
  await c.end();
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
