// Repair for two goalie rules, both found 2026-10-03 checking every career
// against the NHL (fixed in scripts/backfill-season.ts and
// lib/stats/parse-extras.ts too):
//
// 1. A goalie sent in only for the shootout has 0:00 of ice time, so the
//    loaders skipped him, but the NHL charges him the decision and counts
//    a game played (Curtis Joseph, 2008-10-21). His game went missing and
//    the starter was later given his decision. Adds his row and gives every
//    goalie in that team-game the NHL's own decision.
// 2. "O" in a playoff game was stored as L. The NHL charges an OTL there in
//    the 2020 bubble's seeding round-robin (Holtby, 2020-08-03); an ordinary
//    playoff OT loss is "L". Stored as OTL.
//
// Reads the cached box scores (data/raw/nhl/<season>/<id>.box.json.gz);
// games the cache doesn't have are fetched. Fixes the site's tables
// (goalie_game_stats, 2007-08 on) and the stats history (nhl_goalie_games).
//
// Usage:
//   npx tsx --env-file=.env.local scripts/repair-shootout-goalies.ts          (dry run)
//   npx tsx --env-file=.env.local scripts/repair-shootout-goalies.ts --apply

import { readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { Client } from "pg";

const APPLY = process.argv.includes("--apply");
const CACHE = "data/raw/nhl";

/* eslint-disable @typescript-eslint/no-explicit-any -- the NHL feed is untyped JSON */
const toSec = (t?: string | null) => (t ? Number(t.split(":")[0]) * 60 + Number(t.split(":")[1]) : 0);
const mapDecision = (d?: string | null) => (d === "W" ? "W" : d === "L" ? "L" : d === "O" ? "OTL" : d === "T" ? "T" : null);

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  // Every team-game with a goalie at 0:00 who holds a decision, or a
  // playoff "O", from the cache.
  type Fix = { gameId: number; season: string; side: "homeTeam" | "awayTeam"; goalies: any[] };
  const fixes: Fix[] = [];
  const cached = new Set<number>();
  const scan = (box: any, season: string) => {
    for (const side of ["homeTeam", "awayTeam"] as const) {
      const goalies: any[] = box?.playerByGameStats?.[side]?.goalies ?? [];
      const shootoutOnly = goalies.some((x) => toSec(x.toi) === 0 && x.decision);
      const playoffO = box.gameType === 3 && goalies.some((x) => x.decision === "O");
      if (shootoutOnly || playoffO) fixes.push({ gameId: box.id, season, side, goalies });
    }
  };
  for (const season of readdirSync(CACHE).filter((d) => /^\d{8}$/.test(d)).sort()) {
    for (const f of readdirSync(path.join(CACHE, season)).filter((x) => x.endsWith(".box.json.gz"))) {
      const box = JSON.parse(gunzipSync(readFileSync(path.join(CACHE, season, f))).toString());
      cached.add(box.id);
      scan(box, season);
    }
  }
  // The site's games the cache doesn't have (this season's newest).
  const { rows: missing } = await db.query(`select id, season_id from games where not (id = any($1::int[]))`, [[...cached]]);
  for (const g of missing) {
    let box: any = null;
    for (let i = 0; i < 6 && !box; i++) {
      const res = await fetch(`https://api-web.nhle.com/v1/gamecenter/${g.id}/boxscore`);
      if (res.ok) box = await res.json();
      else await new Promise((r) => setTimeout(r, 2000 * 2 ** i)); // 429s under load
    }
    if (!box) throw new Error(`box score ${g.id} unavailable`);
    scan(box, g.season_id);
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log(`Scanned ${cached.size} cached box scores and ${missing.length} fetched: ${fixes.length} team-games to check.`);

  let changes = 0;
  const skipped: string[] = [];
  for (const fx of fixes) {
    // Team ids from our own game rows (the site's and the history's).
    const { rows: [site] } = await db.query(`select home_team_id, away_team_id from games where id = $1`, [fx.gameId]);
    const { rows: [hist] } = await db.query(`select home_team_id, away_team_id from nhl_games where id = $1`, [fx.gameId]);
    const want = fx.goalies.filter((x) => toSec(x.toi) > 0 || x.decision);
    for (const [table, row, teamCol] of [["goalie_game_stats", site, "team_id"], ["nhl_goalie_games", hist, "team_id"]] as const) {
      if (!row) continue;
      const teamId = fx.side === "homeTeam" ? row.home_team_id : row.away_team_id;
      const toiCol = table === "goalie_game_stats" ? "toi_seconds" : "toi_sec";
      const { rows: have } = await db.query(`select player_id, decision, ${toiCol} as toi from ${table} where game_id = $1 and ${teamCol} = $2`, [fx.gameId, teamId]);
      for (const x of want) {
        const d = mapDecision(x.decision);
        const cur = have.find((h) => Number(h.player_id) === x.playerId);
        if (cur && (cur.decision ?? null) === d) continue;
        if (!cur && table === "goalie_game_stats") {
          const { rowCount } = await db.query(`select 1 from players where id = $1`, [x.playerId]);
          if (!rowCount) {
            skipped.push(`${fx.gameId} ${x.playerId}: not in players`);
            continue;
          }
        }
        changes++;
        console.log(`${table} ${fx.season} ${fx.gameId} ${x.name?.default ?? x.playerId} (${x.toi ?? "no toi"}): ${cur ? `decision ${cur.decision} -> ${d}` : `add, decision ${d}`}`);
        if (!APPLY) continue;
        if (cur) await db.query(`update ${table} set decision = $3 where game_id = $1 and player_id = $2`, [fx.gameId, x.playerId, d]);
        else if (table === "goalie_game_stats")
          await db.query(
            `insert into goalie_game_stats (game_id, player_id, team_id, decision, shots_against, saves, goals_against, save_pct, toi_seconds, shutout, source)
             values ($1, $2, $3, $4, $5, $6, $7, null, $8, false, 'nhl-api')`,
            [fx.gameId, x.playerId, teamId, d, x.shotsAgainst ?? 0, x.saves ?? 0, x.goalsAgainst ?? 0, toSec(x.toi)],
          );
        else
          await db.query(
            `insert into nhl_goalie_games (game_id, player_id, team_id, started, decision, toi_sec, shots_against, saves, goals_against)
             values ($1, $2, $3, false, $4, $5, $6, $7, $8)`,
            [fx.gameId, x.playerId, teamId, d, toSec(x.toi), x.shotsAgainst ?? 0, x.saves ?? 0, x.goalsAgainst ?? 0],
          );
      }
    }
  }
  console.log(`\n${changes} changes ${APPLY ? "applied" : "to apply (dry run; --apply to write)"}.`);
  for (const s of skipped) console.log(`  skipped ${s}`);
  await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
