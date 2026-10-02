// Pulls every club's current roster from the NHL and stores each player's
// official headshot URL (player_headshots). Players who leave every roster
// keep their last photo; nobody is ever deleted. Runs daily in CI.
//
// Usage: npx tsx --env-file=.env.local scripts/sync-headshots.ts

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
  const problems: string[] = [];
  for (const abbrev of Object.keys(TEAM_NICKNAMES)) {
    const roster = await get(`${API}/roster/${abbrev}/current`);
    const players = roster ? [...(roster.forwards ?? []), ...(roster.defensemen ?? []), ...(roster.goalies ?? [])] : [];
    if (players.length < 15) problems.push(`${abbrev}: only ${players.length} players on the current roster`);
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
  console.log(`${stored} current-roster headshots stored (${t.n} on file).`);
  for (const p of problems) console.log(`  WARN ${p}`);
  // A bad day at the NHL shouldn't fail the refresh, but an empty run should.
  process.exit(stored < 500 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
