// Games the NHL's box score leaves a player out of, though his NHL game log
// (the NHL's per-player record of appearances, and what its official
// totals count) has the game. Mostly resumed games: a game abandoned after
// a medical emergency restarts weeks later with the score carried over,
// the box score lists only the restart's lineup, and the NHL counts the
// original portion's stats. Nathan Horton's goal in CBJ-DAL (abandoned
// 2014-03-10 when Rich Peverley collapsed, resumed 2014-04-09) and Hampus
// Lindholm's assist in STL-ANA (Jay Bouwmeester, 2020-02-11, resumed
// 2020-03-11) are each in the game's own scoring summary. Found 2026-10-03
// by scripts/qa/audit-season-totals.ts with the five others below. Adds each missing row from the game
// log's own numbers (stats the log doesn't carry stay null). A game that
// isn't in our game tables at all (the 1988 Final's suspended blackout
// game, 1987030999) is reported and skipped.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/repair-log-only-appearances.ts          (dry run)
//   npx tsx --env-file=.env.local scripts/repair-log-only-appearances.ts --apply

import { Client } from "pg";

const APPLY = process.argv.includes("--apply");
const HISTORY_UNTIL = "20072008";

// [player, season, game type (2 regular, 3 playoffs), goalie]
const CASES: [number, string, 2 | 3, boolean][] = [
  [8470596, "20132014", 2, false], // Nathan Horton
  [8476854, "20192020", 2, false], // Hampus Lindholm
  [8473614, "20142015", 2, true], // Richard Bachman
  [8447591, "19601961", 3, false], // Chico Maki
  [8449988, "19661967", 2, true], // Glenn Hall
  [8449859, "19671968", 2, true], // Roger Crozier
  [8448197, "19271928", 2, false], // Joe Primeau
];

/* eslint-disable @typescript-eslint/no-explicit-any -- the NHL feed is untyped JSON */
async function get(url: string): Promise<any> {
  for (let i = 0; i < 6; i++) {
    const res = await fetch(url).catch(() => null);
    if (res?.ok) return res.json();
    await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
  }
  throw new Error(`failed: ${url}`);
}
const toSec = (t?: string | null) => (t ? Number(t.split(":")[0]) * 60 + Number(t.split(":")[1]) : null);
const mapDecision = (d?: string | null) => (d === "W" ? "W" : d === "L" ? "L" : d === "O" ? "OTL" : d === "T" ? "T" : null);

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  let planned = 0;
  for (const [pid, season, gt, goalie] of CASES) {
    const log: any[] = (await get(`https://api-web.nhle.com/v1/player/${pid}/game-log/${season}/${gt}`)).gameLog ?? [];
    const site = season >= HISTORY_UNTIL;
    const table = site ? (goalie ? "goalie_game_stats" : "skater_game_stats") : goalie ? "nhl_goalie_games" : "nhl_skater_games";
    const { rows: have } = await db.query(`select game_id${!site && !goalie ? ", played" : ""} from ${table} where player_id = $1 and game_id = any($2::int[])`, [pid, log.map((g) => g.gameId)]);
    const byGame = new Map(have.map((r) => [Number(r.game_id), r]));
    const missing = log.filter((g) => !byGame.has(g.gameId) || byGame.get(g.gameId).played === false);
    if (!missing.length) console.log(`${pid} ${season}: his NHL game log has no game we lack (${log.length} games); the NHL's total disagrees with its own log`);
    for (const g of missing) {
      const gameTable = site ? "games" : "nhl_games";
      const { rows: [game] } = await db.query(`select home_team_id, away_team_id from ${gameTable} where id = $1`, [g.gameId]);
      if (!game) {
        console.log(`${pid} ${season} ${g.gameId} ${g.gameDate}: game not in ${gameTable}; skipped`);
        continue;
      }
      const teamId = g.homeRoadFlag === "H" ? game.home_team_id : game.away_team_id;
      const pm = season >= "19591960" ? (g.plusMinus ?? null) : null;
      const sog = season >= "19591960" ? (g.shots ?? null) : null;
      if (goalie) {
        const { rows: others } = await db.query(`select player_id, decision from ${table} where game_id = $1 and team_id = $2`, [g.gameId, teamId]);
        console.log(`  already in that net: ${others.map((o) => `${o.player_id} (${o.decision ?? "no decision"})`).join(", ") || "nobody"}`);
      }
      planned++;
      console.log(`${table} ${season} ${g.gameId} ${g.gameDate} player ${pid} (team ${teamId}): ${goalie ? `decision ${mapDecision(g.decision)}, ${g.shotsAgainst ?? "?"} SA, ${g.goalsAgainst} GA, toi ${g.toi}` : `${g.goals} G ${g.assists} A, ${g.pim} PIM, shots ${sog}, +/- ${pm}, toi ${g.toi ?? "-"}`}${byGame.has(g.gameId) ? " (mark played)" : ""}`);
      if (!APPLY) continue;
      if (table === "skater_game_stats")
        await db.query(
          `insert into skater_game_stats (game_id, player_id, team_id, goals, assists, shots, penalty_minutes, plus_minus, pp_goals, toi_seconds, source)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'nhl-gamelog')`,
          [g.gameId, pid, teamId, g.goals, g.assists, g.shots ?? null, g.pim ?? null, g.plusMinus ?? null, g.powerPlayGoals ?? null, toSec(g.toi)],
        );
      else if (table === "goalie_game_stats")
        await db.query(
          `insert into goalie_game_stats (game_id, player_id, team_id, decision, shots_against, saves, goals_against, save_pct, toi_seconds, shutout, source)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, 'nhl-gamelog')`,
          [g.gameId, pid, teamId, mapDecision(g.decision), g.shotsAgainst ?? null, g.shotsAgainst != null ? g.shotsAgainst - g.goalsAgainst : null, g.goalsAgainst ?? null, g.savePctg ?? null, toSec(g.toi) ?? 0],
        );
      else if (table === "nhl_skater_games") {
        if (byGame.has(g.gameId)) await db.query(`update nhl_skater_games set played = true, goals = $3, assists = $4, pim = $5 where game_id = $1 and player_id = $2`, [g.gameId, pid, g.goals, g.assists, g.pim ?? 0]);
        else
          await db.query(
            `insert into nhl_skater_games (game_id, player_id, team_id, position, goals, assists, pim, sog, plus_minus, played)
             values ($1, $2, $3, null, $4, $5, $6, $7, $8, true)`,
            [g.gameId, pid, teamId, g.goals, g.assists, g.pim ?? 0, sog, pm],
          );
      } else
        await db.query(
          `insert into nhl_goalie_games (game_id, player_id, team_id, started, decision, toi_sec, shots_against, saves, goals_against)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [g.gameId, pid, teamId, g.gamesStarted === 1, mapDecision(g.decision), toSec(g.toi), g.shotsAgainst ?? null, g.shotsAgainst != null ? g.shotsAgainst - g.goalsAgainst : null, g.goalsAgainst ?? null],
        );
    }
  }
  console.log(`\n${planned} rows ${APPLY ? "written" : "to write (dry run; --apply to write)"}.`);
  await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
