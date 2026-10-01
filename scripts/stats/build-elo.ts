// Builds Elo ratings for every franchise lineage since 1917 (spec section
// 6) and stores elo_history / elo_current. With --tune, first grid-searches
// K, home ice per era, offseason reversion and the margin coefficient to
// minimize log loss on the TRAINING seasons only (every fifth season is
// held out, spec section 13), then reports held-out log loss per era
// against a home-ice-only baseline, and prints the winning parameters to
// paste into config/stats.ts.
//
// Usage: npx tsx --env-file=.env.local scripts/stats/build-elo.ts [--tune] [--dry-run]

import { Client } from "pg";
import { runElo, logLoss, type EloGame, type EloParams, type EloRow } from "../../lib/stats/elo";
import { insertRows } from "../../lib/stats/store-games";
import { ELO, ERAS, eraOf, isHeldOutSeason } from "../../config/stats";

const eraId = (season: string) => eraOf(season).id;

export async function loadEloGames(client: Client): Promise<EloGame[]> {
  const { rows } = await client.query(
    `select g.id, g.season, g.game_date::text as date, g.game_type = 'playoff' as playoff,
            ht.lineage_id as home, at.lineage_id as away, g.home_score, g.away_score, g.final_state
     from nhl_games g join nhl_teams ht on ht.id = g.home_team_id join nhl_teams at on at.id = g.away_team_id
     where not (g.id = any($1))`,
    [ELO.excludeGameIds],
  );
  return rows.map((r) => ({ id: r.id, season: r.season, date: r.date, playoff: r.playoff, home: r.home, away: r.away, homeScore: r.home_score, awayScore: r.away_score, finalState: r.final_state }));
}

const seasonOfRow = (games: Map<number, EloGame>) => (r: EloRow) => games.get(r.gameId)!.season;

function trainLoss(games: EloGame[], byId: Map<number, EloGame>, p: EloParams): number {
  const { rows } = runElo(games, p, eraId);
  const season = seasonOfRow(byId);
  return logLoss(rows, (r) => !isHeldOutSeason(season(r))).loss;
}

function tune(games: EloGame[], byId: Map<number, EloGame>, start: EloParams): EloParams {
  let best = { ...start, homeIce: { ...start.homeIce } };
  let bestLoss = trainLoss(games, byId, best);
  const grid = () => {
    for (const k of [4, 5, 6, 7, 8, 10, 12])
      for (const reversion of [0.15, 0.2, 0.25, 0.3, 0.4, 0.5])
        for (const marginCoef of [0, 0.25, 0.5, 0.75, 1]) {
          const p = { ...best, kRegular: k, kPlayoff: (k * 4) / 3, reversion, marginCoef };
          const loss = trainLoss(games, byId, p);
          if (loss < bestLoss) [best, bestLoss] = [p, loss];
        }
  };
  const homeIce = () => {
    for (let round = 0; round < 2; round++)
      for (const era of ERAS)
        for (let h = 0; h <= 140; h += 10) {
          const p = { ...best, homeIce: { ...best.homeIce, [era.id]: h } };
          const loss = trainLoss(games, byId, p);
          if (loss < bestLoss) [best, bestLoss] = [p, loss];
        }
  };
  console.log(`start: training log loss ${bestLoss.toFixed(5)}`);
  grid();
  console.log(`after K/reversion/margin grid: ${bestLoss.toFixed(5)}`);
  homeIce();
  console.log(`after home ice per era: ${bestLoss.toFixed(5)}`);
  grid();
  console.log(`after second grid pass: ${bestLoss.toFixed(5)}`);
  return best;
}

function report(games: EloGame[], byId: Map<number, EloGame>, p: EloParams) {
  const { rows } = runElo(games, p, eraId);
  const season = seasonOfRow(byId);
  // Baseline: a constant home win expectation per era, fit on training seasons.
  const table = ERAS.map((era) => {
    const inEra = (r: EloRow, held: boolean) => eraId(season(r)) === era.id && isHeldOutSeason(season(r)) === held;
    const homeRows = rows.filter((_, i) => i % 2 === 0);
    const train = homeRows.filter((r) => inEra(r, false));
    const base = train.length ? train.reduce((s, r) => s + r.result, 0) / train.length : 0.5;
    const baseRows = rows.map((r, i) => (i % 2 === 0 ? { ...r, expected: base } : r));
    const elo = logLoss(rows, (r) => inEra(r, true));
    const baseline = logLoss(baseRows, (r) => inEra(r, true));
    return { era: era.label, heldOutGames: elo.n, eloLogLoss: +elo.loss.toFixed(4), baselineLogLoss: +baseline.loss.toFixed(4), beatsBaseline: elo.n ? elo.loss < baseline.loss : null };
  });
  console.table(table);
  return { rows, table };
}

async function main() {
  const tuneMode = process.argv.includes("--tune");
  const dry = process.argv.includes("--dry-run");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const games = await loadEloGames(client);
  const byId = new Map(games.map((g) => [g.id, g]));
  console.log(`${games.length} games, ${new Set(games.map((g) => g.season)).size} seasons.`);

  let params: EloParams = ELO.params;
  let version = ELO.modelVersion;
  if (tuneMode) {
    params = tune(games, byId, ELO.params);
    version = `${ELO.modelVersion}+tuned-${new Date().toISOString().slice(0, 10)}`;
    console.log("\nTuned parameters (paste into config/stats.ts ELO.params):");
    console.log(JSON.stringify(params, null, 2));
  }
  const { rows } = report(games, byId, params);

  if (!dry) {
    const { ratings } = runElo(games, params, eraId);
    const lastDate = new Map<number, string>();
    for (const r of rows) lastDate.set(r.team, r.date);
    await client.query("begin");
    await client.query("delete from elo_history");
    await insertRows(client, "elo_history", ["franchise_id", "game_id", "date", "rating_before", "rating_after", "expected", "result", "model_version"], rows.map((r) => [r.team, r.gameId, r.date, r.before, r.after, r.expected, r.result, version]));
    await client.query("delete from elo_current");
    await insertRows(client, "elo_current", ["franchise_id", "rating", "last_game_date", "model_version"], [...ratings].map(([t, r]) => [t, r, lastDate.get(t), version]));
    await client.query("commit");
    console.log(`Stored ${rows.length} elo_history rows and ${ratings.size} current ratings (${version}).`);
  }
  await client.end();
}

if (process.argv[1]?.endsWith("build-elo.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
