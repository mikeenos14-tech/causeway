// Pulls every club's current roster from the NHL (32 calls) and stores:
//   - current_rosters: who is on each roster now (the Roster pages read
//     this, so they never wait on the NHL); a team's rows are replaced only
//     when its roster came back complete, so a failed call keeps the last
//     good roster rather than emptying it
//   - player_headshots: each player's official photo URL (kept after he
//     leaves every roster)
// Runs hourly in CI.
//
// Usage: npx tsx --env-file=.env.local scripts/sync-rosters.ts

import { Client } from "pg";
import { TEAM_NICKNAMES } from "../lib/team-names";

const API = "https://api-web.nhle.com/v1";

/* eslint-disable @typescript-eslint/no-explicit-any -- the NHL feed is untyped JSON */
async function get(url: string): Promise<any> {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "causeway/1.0" } });
      if (res.ok) return res.json();
      if (res.status === 404) return null;
    } catch {
      // network error: retry
    }
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  throw new Error(`failed: ${url}`);
}

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  let stored = 0;
  let rostered = 0;
  const problems: string[] = [];
  for (const abbrev of Object.keys(TEAM_NICKNAMES)) {
    const roster = await get(`${API}/roster/${abbrev}/current`);
    const players = roster ? [...(roster.forwards ?? []), ...(roster.defensemen ?? []), ...(roster.goalies ?? [])] : [];
    if (players.length < 15) {
      problems.push(`${abbrev}: only ${players.length} players on the current roster; keeping the last good roster`);
      continue;
    }
    try {
      await db.query("begin");
      await db.query(`delete from current_rosters where team_abbrev = $1 or player_id = any($2::int[])`, [abbrev, players.map((p) => p.id)]);
      for (const p of players) {
        await db.query(
          `insert into current_rosters (player_id, team_abbrev, full_name, position, sweater_number, synced_at) values ($1, $2, $3, $4, $5, now())`,
          [p.id, abbrev, `${p.firstName.default} ${p.lastName.default}`, p.positionCode, p.sweaterNumber ?? null],
        );
      }
      await db.query("commit");
    } catch (err) {
      await db.query("rollback");
      throw err;
    }
    rostered += players.length;
    for (const p of players) {
      const url: string = p.headshot ?? "";
      const m = url.match(/^https:\/\/assets\.nhle\.com\/mugs\/nhl\/(\d{8})\/([A-Z]{3})\/(\d+)\.png$/);
      if (!m || Number(m[3]) !== p.id) {
        problems.push(`${abbrev} ${p.id}: unexpected headshot URL ${url}`);
        continue;
      }
      await db.query(
        `insert into player_headshots (player_id, url, team_abbrev, season_id, synced_at) values ($1, $2, $3, $4, now())
         on conflict (player_id) do update set url = excluded.url, team_abbrev = excluded.team_abbrev, season_id = excluded.season_id, synced_at = now()`,
        [p.id, url, abbrev, m[1]],
      );
      stored++;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  const { rows: [t] } = await db.query(`select count(*)::int n from player_headshots`);
  await db.end();
  console.log(`${rostered} players on 32 current rosters; ${stored} current-roster headshots stored (${t.n} on file).`);
  for (const p of problems) console.log(`  WARN ${p}`);
  // A bad day at the NHL shouldn't fail the refresh, but an empty run should.
  process.exit(stored < 500 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
