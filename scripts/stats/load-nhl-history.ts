// Phase 0 backfill, step 2 of 2: parse the cached NHL feed
// (fetch-nhl-history.ts) into the nhl_* tables. Idempotent: each game's
// events are replaced wholesale, so re-running after a parser fix rewrites
// cleanly. Reads only the local cache, never the API (except the small
// franchise and team lists).
//
// Usage: npx tsx --env-file=.env.local scripts/stats/load-nhl-history.ts [--from 19171918] [--to 20262027]

import { Client } from "pg";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseGame, type ListRow, type ParsedGame } from "../../lib/stats/parse-game";
import { readCached } from "./fetch-nhl-history";
import { LINEAGE_OVERRIDES, EXCLUDE_NON_NHL_OPPONENTS } from "../../config/stats";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const FROM = arg("from") ?? "19171918";
const TO = arg("to") ?? "99999999";

// Multi-row insert in chunks (Postgres caps a statement at 65,535 params).
async function insertRows(client: Client, table: string, cols: string[], rows: unknown[][], conflict = "") {
  const per = Math.max(1, Math.floor(60000 / cols.length));
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    const values = chunk.map((_, r) => `(${cols.map((_, c) => `$${r * cols.length + c + 1}`).join(",")})`).join(",");
    await client.query(`insert into ${table} (${cols.join(",")}) values ${values} ${conflict}`, chunk.flat());
  }
}

async function loadFranchisesAndTeams(client: Client) {
  const get = async (url: string) => (await (await fetch(url, { headers: { "User-Agent": "causeway-backfill/1.0" } })).json()).data;
  const franchises = await get("https://api.nhle.com/stats/rest/en/franchise?include=firstSeason.id&include=lastSeason.id");
  const teams = await get("https://api.nhle.com/stats/rest/en/team");
  await insertRows(
    client,
    "nhl_franchises",
    ["id", "name", "first_season", "last_season"],
    franchises.map((f: { id: number; fullName: string; firstSeason: { id: number }; lastSeason: { id: number } | null }) => [f.id, f.fullName, String(f.firstSeason.id), f.lastSeason ? String(f.lastSeason.id) : null]),
    "on conflict (id) do update set name = excluded.name, first_season = excluded.first_season, last_season = excluded.last_season",
  );
  const overrides = new Map(LINEAGE_OVERRIDES.map((o) => [o.teamId, o]));
  await insertRows(
    client,
    "nhl_teams",
    ["id", "franchise_id", "lineage_id", "tri_code", "full_name"],
    teams
      .filter((t: { franchiseId: number | null }) => t.franchiseId != null)
      .map((t: { id: number; franchiseId: number; triCode: string; fullName: string }) => {
        const o = overrides.get(t.id);
        const franchise = o?.franchiseId ?? t.franchiseId;
        return [t.id, franchise, o?.lineageId ?? franchise, t.triCode, t.fullName];
      }),
    "on conflict (id) do update set franchise_id = excluded.franchise_id, lineage_id = excluded.lineage_id, tri_code = excluded.tri_code, full_name = excluded.full_name",
  );
  console.log(`${franchises.length} franchises, ${teams.length} teams loaded (${LINEAGE_OVERRIDES.length} lineage overrides).`);
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await loadFranchisesAndTeams(client);

  const list: ListRow[] = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "data", "raw", "nhl", "games-list.json"), "utf8")).data.filter(
    (g: ListRow & { gameStateId: number }) => (g.gameStateId === 7 || g.gameStateId === 6) && String(g.season) >= FROM && String(g.season) <= TO,
  );
  const { rows: teamRows } = await client.query(`select id from nhl_teams`);
  const nhlTeams = new Set(teamRows.map((r) => Number(r.id)));
  const nonNhl = list.filter((g) => !nhlTeams.has(g.homeTeamId) || !nhlTeams.has(g.visitingTeamId));
  if (nonNhl.length && EXCLUDE_NON_NHL_OPPONENTS) {
    console.log(`Skipping ${nonNhl.length} games against non-NHL teams (pre-1927 Cup Finals vs other leagues).`);
    for (const g of nonNhl) list.splice(list.indexOf(g), 1);
  }
  const seasons = [...new Set(list.map((g) => String(g.season)))].sort();
  let loaded = 0;
  let missing = 0;
  const warnings: string[] = [];

  for (const season of seasons) {
    const parsed: ParsedGame[] = [];
    for (const g of list.filter((x) => String(x.season) === season)) {
      const pbp = readCached(g.season, g.id, "pbp");
      const landing = readCached(g.season, g.id, "landing");
      if (!pbp) {
        missing++;
        continue;
      }
      const p = parseGame(g, pbp, landing);
      for (const w of p.warnings) warnings.push(`${g.id}: ${w}`);
      parsed.push(p);
    }
    if (parsed.length === 0) continue;

    await client.query("begin");
    try {
      const players = new Map(parsed.flatMap((p) => p.players).map((pl) => [pl.id, pl]));
      await insertRows(client, "nhl_players", ["id", "full_name", "position"], [...players.values()].map((p) => [p.id, p.full_name, p.position]), "on conflict (id) do update set full_name = excluded.full_name, position = coalesce(excluded.position, nhl_players.position)");

      const gcols = Object.keys(parsed[0].game);
      await insertRows(
        client,
        "nhl_games",
        gcols,
        parsed.map((p) => gcols.map((c) => p.game[c as keyof ParsedGame["game"]])),
        `on conflict (id) do update set ${gcols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", ")}, loaded_at = now()`,
      );
      const ids = parsed.map((p) => p.game.id);
      for (const t of ["nhl_goal_events", "nhl_penalty_events", "nhl_period_scores"]) await client.query(`delete from ${t} where game_id = any($1)`, [ids]);

      const goalCols = ["event_id", "period", "period_type", "time_in_period_sec", "time_elapsed_sec", "team_id", "scorer_id", "assist1_id", "assist2_id", "strength", "empty_net", "situation_code", "score_before_home", "score_before_away"] as const;
      await insertRows(client, "nhl_goal_events", ["game_id", ...goalCols], parsed.flatMap((p) => p.goals.map((g) => [p.game.id, ...goalCols.map((c) => g[c])])));
      const penCols = ["event_id", "period", "period_type", "time_in_period_sec", "time_elapsed_sec", "team_id", "player_id", "drawn_by_id", "served_by_id", "minutes", "type_code", "infraction", "situation_code"] as const;
      // The feed occasionally repeats an event id; keep the first.
      await insertRows(client, "nhl_penalty_events", ["game_id", ...penCols], parsed.flatMap((p) => p.penalties.map((x) => [p.game.id, ...penCols.map((c) => x[c])])), "on conflict do nothing");
      const perCols = ["period", "period_type", "home_goals", "away_goals", "home_shots", "away_shots"] as const;
      await insertRows(client, "nhl_period_scores", ["game_id", ...perCols], parsed.flatMap((p) => p.periods.map((x) => [p.game.id, ...perCols.map((c) => x[c])])), "on conflict do nothing");
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw new Error(`Season ${season}: ${err instanceof Error ? err.message : err}`);
    }
    loaded += parsed.length;
    console.log(`${season}: ${parsed.length} games loaded (total ${loaded}, ${missing} not yet fetched)`);
  }

  console.log(`\nDone. ${loaded} games loaded; ${missing} not in the cache yet.`);
  if (warnings.length) console.log(`${warnings.length} parser warnings, e.g.:\n  ${warnings.slice(0, 10).join("\n  ")}`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
