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

const ROOT = join(import.meta.dirname, "..", "..", "data", "raw", "nhl");
const onlyArg = process.argv.indexOf("--only");
const ONLY = onlyArg >= 0 ? process.argv[onlyArg + 1] : null;

/* eslint-disable @typescript-eslint/no-explicit-any -- the NHL feed is untyped JSON */

const toSec = (t?: string) => {
  const m = /^(\d+):(\d{2})$/.exec(t ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

async function loadGoalies(client: Client) {
  const { rows: games } = await client.query(`select id, season, game_type, home_team_id, away_team_id from nhl_games order by id`);
  let loaded = 0;
  let missing = 0;
  for (let i = 0; i < games.length; i += 2000) {
    const batch = games.slice(i, i + 2000);
    const out: unknown[][] = [];
    const ids: number[] = [];
    for (const g of batch) {
      const box = readCached(g.season, g.id, "box") as any;
      if (!box) {
        missing++;
        continue;
      }
      ids.push(g.id);
      for (const [side, teamId] of [["homeTeam", g.home_team_id], ["awayTeam", g.away_team_id]] as const) {
        const goalies: any[] = box.playerByGameStats?.[side]?.goalies ?? [];
        const played = goalies.filter((x) => (toSec(x.toi) ?? 0) > 0);
        // The feed's starter flag when present; otherwise the goalie with
        // the most ice time.
        const flagged = played.find((x) => x.starter === true);
        const starter = flagged ?? [...played].sort((a, b) => (toSec(b.toi) ?? 0) - (toSec(a.toi) ?? 0))[0];
        for (const x of played) {
          // "O" is an OT/SO loss; playoffs have no OTL (same rule as the site).
          const d = x.decision === "W" ? "W" : x.decision === "L" ? "L" : x.decision === "O" ? (g.game_type === "playoff" ? "L" : "OTL") : x.decision === "T" ? "T" : null;
          out.push([g.id, x.playerId, teamId, x === starter, d, toSec(x.toi), x.shotsAgainst ?? null, x.saves ?? null, x.goalsAgainst ?? null]);
        }
      }
    }
    if (!ids.length) continue;
    await client.query("begin");
    await client.query(`delete from nhl_goalie_games where game_id = any($1)`, [ids]);
    await insertRows(client, "nhl_goalie_games", ["game_id", "player_id", "team_id", "started", "decision", "toi_sec", "shots_against", "saves", "goals_against"], out, "on conflict do nothing");
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
  const { rows } = await client.query(
    `select distinct g.season, t.tri_code, t.id from nhl_games g
     join nhl_teams t on t.id in (g.home_team_id, g.away_team_id) where g.game_type = 'regular'`,
  );
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
      for (const s of data.standings ?? []) {
        const season = String(s.seasonId);
        const abbrev = s.teamAbbrev?.default;
        const teamId = idFor.get(`${season}|${abbrev}`);
        if (!teamId) {
          unresolved.add(`${season} ${abbrev}`);
          continue;
        }
        out.push([date, season, teamId, s.gamesPlayed, s.wins, s.losses, s.otLosses ?? 0, s.ties ?? 0, s.points, s.goalFor ?? null, s.goalAgainst ?? null, s.divisionName ?? null, s.conferenceName ?? null, s.divisionSequence || null, s.conferenceSequence || null, s.leagueSequence || null, s.wildcardSequence || null]);
      }
    }
    await client.query("begin");
    await client.query(`delete from nhl_standings where date = any($1::date[])`, [dates]);
    await insertRows(client, "nhl_standings", ["date", "season", "team_id", "games_played", "wins", "losses", "ot_losses", "ties", "points", "goals_for", "goals_against", "division", "conference", "division_rank", "conference_rank", "league_rank", "wildcard_rank"], out, "on conflict do nothing");
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
