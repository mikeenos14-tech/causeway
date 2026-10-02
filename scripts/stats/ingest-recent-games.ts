// Keeps the stats history current (spec section 3, ingest_finals): run by
// the hourly refresh. Loads every finished game of the current season that
// isn't in nhl_games yet, and re-loads anything that finished in the last
// 48 hours, since the NHL corrects scoring credit after games: events,
// goalies (boxscore), and the league standings for the last two game
// dates. Fetches directly (no local cache, which doesn't exist on the CI
// runner).
//
// Usage: npx tsx --env-file=.env.local scripts/stats/ingest-recent-games.ts

import { Client } from "pg";
import { parseGame, type ListRow } from "../../lib/stats/parse-game";
import { storeParsedGames, insertRows } from "../../lib/stats/store-games";
import { goalieRows, standingsRows, GOALIE_COLS, STANDINGS_COLS, TEAM_CODES_SQL } from "../../lib/stats/parse-extras";

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
  const goalies: unknown[][] = [];
  for (const g of todo) {
    const pbp = await getJson(`https://api-web.nhle.com/v1/gamecenter/${g.id}/play-by-play`);
    const landing = await getJson(`https://api-web.nhle.com/v1/gamecenter/${g.id}/landing`);
    const box = await getJson(`https://api-web.nhle.com/v1/gamecenter/${g.id}/boxscore`);
    if (!pbp) continue;
    const p = parseGame(g, pbp, landing);
    if (!p.game.goals_match_final) console.warn(`  ${g.id}: goal events don't add up to the final score yet`);
    parsed.push(p);
    if (box) goalies.push(...goalieRows(box, { id: g.id, game_type: p.game.game_type, home_team_id: g.homeTeamId, away_team_id: g.visitingTeamId }));
  }
  await storeParsedGames(client, parsed);
  if (parsed.length) {
    await client.query("begin");
    await client.query(`delete from nhl_goalie_games where game_id = any($1)`, [parsed.map((p) => p.game.id)]);
    await insertRows(client, "nhl_goalie_games", GOALIE_COLS, goalies, "on conflict do nothing");
    await client.query("commit");
  }
  console.log(`Stored ${parsed.length} games (${goalies.length} goalie rows).`);

  // Standings as of the two most recent regular-season game dates (the
  // later one may still be in progress; re-fetched next hour).
  const dates = [...new Set(finals.filter((g) => g.gameType === 2).map((g) => g.gameDate))].sort().slice(-2);
  const { rows: codes } = await client.query(TEAM_CODES_SQL);
  const idFor = new Map(codes.map((r) => [`${r.season}|${r.tri_code}`, Number(r.id)]));
  for (const date of dates) {
    const data = await getJson(`https://api-web.nhle.com/v1/standings/${date}`);
    if (!data) continue;
    const unresolved = new Set<string>();
    const rows = standingsRows(data, date, idFor, unresolved);
    await client.query("begin");
    await client.query(`delete from nhl_standings where date = $1`, [date]);
    await insertRows(client, "nhl_standings", STANDINGS_COLS, rows, "on conflict do nothing");
    await client.query("commit");
    console.log(`Standings ${date}: ${rows.length} teams${unresolved.size ? ` (unresolved: ${[...unresolved].join(", ")})` : ""}.`);
  }
  // games.ot_loser_point (migration 0021 on main): an OT loss on an
  // empty-net goal earns no point. Set from the goal events just stored;
  // idempotent, and covers any game the site's own refresh loaded first.
  const { rowCount } = await client.query(
    `update games g set ot_loser_point = false
     where g.game_type = 'regular' and g.game_end_type = 'overtime' and g.ot_loser_point
       and exists (select 1 from nhl_goal_events e where e.game_id = g.id and e.period_type = 'OT' and e.empty_net)`,
  );
  if (rowCount) console.log(`Marked ${rowCount} OT loss(es) on an empty-net goal as no-point losses.`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
