// Loads the cached boxscores (goalie per game) and standings-by-date into
// nhl_goalie_games and nhl_standings. Reads only the local cache. Idempotent:
// rows are replaced per game and per date.
//
// Usage: npx tsx --env-file=.env.local scripts/stats/load-nhl-extras.ts [--only goalies|standings]

import { Client } from "pg";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { readCached } from "./fetch-nhl-history";
import { insertRows } from "../../lib/stats/store-games";
import { goalieRows, standingsRows, GOALIE_COLS, STANDINGS_COLS, TEAM_CODES_SQL } from "../../lib/stats/parse-extras";

const ROOT = join(import.meta.dirname, "..", "..", "data", "raw", "nhl");
const onlyArg = process.argv.indexOf("--only");
const ONLY = onlyArg >= 0 ? process.argv[onlyArg + 1] : null;

async function loadGoalies(client: Client) {
  const { rows: games } = await client.query(`select id, season, game_type, home_team_id, away_team_id from nhl_games order by id`);
  let loaded = 0;
  let missing = 0;
  for (let i = 0; i < games.length; i += 2000) {
    const batch = games.slice(i, i + 2000);
    const out: unknown[][] = [];
    const ids: number[] = [];
    for (const g of batch) {
      const box = readCached(g.season, g.id, "box");
      if (!box) {
        missing++;
        continue;
      }
      ids.push(g.id);
      out.push(...goalieRows(box, g));
    }
    if (!ids.length) continue;
    await client.query("begin");
    await client.query(`delete from nhl_goalie_games where game_id = any($1)`, [ids]);
    await insertRows(client, "nhl_goalie_games", GOALIE_COLS, out, "on conflict do nothing");
    await client.query("commit");
    loaded += ids.length;
  }
  console.log(`Goalies: ${loaded} games loaded, ${missing} boxscores not cached yet.`);
}

async function loadStandings(client: Client) {
  const dir = join(ROOT, "standings");
  if (!existsSync(dir)) return console.log("Standings: nothing cached yet.");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json.gz")).sort();
  // Resolve abbreviations per season from the teams that actually played,
  // since a code can belong to different teams over time (e.g. UTA).
  const { rows } = await client.query(TEAM_CODES_SQL);
  const idFor = new Map(rows.map((r) => [`${r.season}|${r.tri_code}`, Number(r.id)]));
  let loaded = 0;
  const unresolved = new Set<string>();
  for (let i = 0; i < files.length; i += 300) {
    const out: unknown[][] = [];
    const dates: string[] = [];
    for (const f of files.slice(i, i + 300)) {
      const data = JSON.parse(gunzipSync(readFileSync(join(dir, f))).toString());
      const date = f.replace(".json.gz", "");
      dates.push(date);
      out.push(...standingsRows(data, date, idFor, unresolved));
    }
    await client.query("begin");
    await client.query(`delete from nhl_standings where date = any($1::date[])`, [dates]);
    await insertRows(client, "nhl_standings", STANDINGS_COLS, out, "on conflict do nothing");
    await client.query("commit");
    loaded += dates.length;
  }
  console.log(`Standings: ${loaded} dates loaded.${unresolved.size ? ` Unresolved team codes: ${[...unresolved].slice(0, 10).join(", ")}` : ""}`);
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  if (ONLY !== "standings") await loadGoalies(client);
  if (ONLY !== "goalies") await loadStandings(client);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
