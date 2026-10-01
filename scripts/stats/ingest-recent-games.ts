// Keeps the stats history current (spec section 3, ingest_finals): run by
// the hourly refresh. Loads every finished game of the current season that
// isn't in nhl_games yet, and re-loads anything that finished in the last
// 48 hours, since the NHL corrects scoring credit after games. Fetches
// directly (no local cache, which doesn't exist on the CI runner).
//
// Usage: npx tsx --env-file=.env.local scripts/stats/ingest-recent-games.ts

import { Client } from "pg";
import { parseGame, type ListRow } from "../../lib/stats/parse-game";
import { storeParsedGames } from "../../lib/stats/store-games";

const UA = { "User-Agent": "causeway-ingest/1.0" };
const RECHECK_HOURS = 48;

async function getJson(url: string): Promise<unknown | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: UA });
    if (res.status === 404) return null;
    if (res.ok) {
      try {
        return await res.json();
      } catch {
        // HTML error body under load; retry
      }
    }
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw new Error(`Failed after retries: ${url}`);
}

function currentSeason(now = new Date()): string {
  const y = now.getUTCFullYear();
  const start = now.getUTCMonth() >= 8 ? y : y - 1; // September on
  return `${start}${start + 1}`;
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const season = currentSeason();
  const list = (await getJson(`https://api.nhle.com/stats/rest/en/game?cayenneExp=season=${season}%20and%20gameType%20in%20(2,3)`)) as { data: (ListRow & { gameStateId: number; easternStartTime: string })[] };
  const finals = list.data.filter((g) => g.gameStateId === 7 || g.gameStateId === 6);

  const { rows } = await client.query(`select id from nhl_games where season = $1`, [season]);
  const have = new Set(rows.map((r) => Number(r.id)));
  const { rows: teamRows } = await client.query(`select id from nhl_teams`);
  const teams = new Set(teamRows.map((r) => Number(r.id)));
  const recent = Date.now() - RECHECK_HOURS * 3600_000;
  const todo = finals.filter(
    (g) => teams.has(g.homeTeamId) && teams.has(g.visitingTeamId) && (!have.has(g.id) || Date.parse(`${g.gameDate}T12:00:00Z`) > recent),
  );
  console.log(`${season}: ${finals.length} finished games, ${todo.length} to load or re-check.`);

  const parsed = [];
  for (const g of todo) {
    const [pbp, landing] = [await getJson(`https://api-web.nhle.com/v1/gamecenter/${g.id}/play-by-play`), await getJson(`https://api-web.nhle.com/v1/gamecenter/${g.id}/landing`)];
    if (!pbp) continue;
    const p = parseGame(g, pbp, landing);
    if (!p.game.goals_match_final) console.warn(`  ${g.id}: goal events don't add up to the final score yet`);
    parsed.push(p);
  }
  await storeParsedGames(client, parsed);
  console.log(`Stored ${parsed.length} games.`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
