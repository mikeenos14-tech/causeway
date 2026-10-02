// Marks every pre-2007 box row (nhl_skater_games.played) from the NHL's
// per-player game logs (cached by fetch-nhl-gamelogs.ts): played = the game
// is in his log. Old boxscores also list players who didn't play.
//
// Checks, printed and failing the run if broken:
//   - a row marked not played has no stats at all (else the box and the
//     log disagree; that game's box check is failed so it isn't shown)
//   - every game in a player's log has his box row (reported)
// A row whose player's log is missing stays null, and nothing from that
// game or season is shown (see lib/history-data.ts, lib/roster-seasons.ts).
//
// One exception, found 2026-10-02: the NHL's game log for Rick Wilson
// (8452477, 1973-77) is empty though he played 239 games. When a player's
// season log is empty but his box rows have stats, the rows are marked
// played only if their count equals his official games played (player
// page); otherwise they stay unmarked.
//
// Usage: npx tsx --env-file=.env.local scripts/stats/load-nhl-appearances.ts

import { Client } from "pg";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";

// Same layout as fetch-nhl-gamelogs.ts (not imported: that file runs its
// fetch on import).
const LOG_ROOT = join(import.meta.dirname, "..", "..", "data", "raw", "nhl-gamelogs");
const logPath = (season: string, playerId: number, type: 2 | 3) => join(LOG_ROOT, season, `${playerId}.${type}.json.gz`);

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const { rows: seasons } = await db.query(`select distinct g.season from nhl_skater_games s join nhl_games g on g.id = s.game_id order by 1`);
  const totals = { played: 0, notPlayed: 0, unmarked: 0, conflicts: 0, logOnly: 0 };
  for (const { season } of seasons) {
    const { rows } = await db.query(
      `select s.game_id, s.player_id, g.game_type, s.goals, s.assists, s.pim, coalesce(s.sog, 0) as sog, coalesce(s.plus_minus, 0) as pm
       from nhl_skater_games s join nhl_games g on g.id = s.game_id where g.season = $1`,
      [season],
    );
    const logs = new Map<string, Set<number> | null>();
    const logFor = (pid: number, type: 2 | 3) => {
      const k = `${pid}|${type}`;
      if (!logs.has(k)) {
        const p = logPath(season, pid, type);
        logs.set(k, existsSync(p) ? new Set<number>(JSON.parse(gunzipSync(readFileSync(p)).toString()).games) : null);
      }
      return logs.get(k)!;
    };
    // Empty logs for a player with stats in the box: count-check against the
    // official games played instead (see header).
    const emptyLogWithStats = new Map<number, typeof rows>();
    for (const r of rows) {
      if (r.game_type !== "regular") continue;
      const log = logFor(Number(r.player_id), 2);
      if (log && log.size === 0) emptyLogWithStats.set(Number(r.player_id), [...(emptyLogWithStats.get(Number(r.player_id)) ?? []), r]);
    }
    const countVerified = new Set<number>();
    for (const [pid, prs] of emptyLogWithStats) {
      if (!prs.some((r) => r.goals || r.assists || r.pim || r.sog || r.pm)) continue;
      const land = await fetch(`https://api-web.nhle.com/v1/player/${pid}/landing`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      const gp = (land?.seasonTotals ?? []).filter((t: { season: number; leagueAbbrev: string; gameTypeId: number }) => String(t.season) === season && t.leagueAbbrev === "NHL" && t.gameTypeId === 2).reduce((a: number, t: { gamesPlayed?: number }) => a + (t.gamesPlayed ?? 0), 0);
      if (gp > 0 && gp === prs.length) countVerified.add(pid);
      console.log(`  ${season} player ${pid}: empty game log, ${prs.length} box rows, official GP ${gp} -> ${gp === prs.length ? "all played" : "left unmarked"}`);
    }
    const played: [number, number][] = [], notPlayed: [number, number][] = [];
    const conflictGames = new Set<number>();
    const boxKeys = new Set(rows.map((r) => `${r.game_id}|${r.player_id}`));
    for (const r of rows) {
      const log = logFor(Number(r.player_id), r.game_type === "playoff" ? 3 : 2);
      if (r.game_type === "regular" && emptyLogWithStats.has(Number(r.player_id)) && emptyLogWithStats.get(Number(r.player_id))!.some((x) => x.goals || x.assists || x.pim || x.sog || x.pm)) {
        if (countVerified.has(Number(r.player_id))) played.push([Number(r.game_id), Number(r.player_id)]);
        else totals.unmarked++;
        continue;
      }
      if (!log) {
        totals.unmarked++;
        continue;
      }
      if (log.has(Number(r.game_id))) played.push([Number(r.game_id), Number(r.player_id)]);
      else {
        notPlayed.push([Number(r.game_id), Number(r.player_id)]);
        if (r.goals || r.assists || r.pim || r.sog || r.pm) conflictGames.add(Number(r.game_id));
      }
    }
    // Games in a log with no box row for that player (reported only). Logs
    // also list the early Cup Finals against other leagues' champions
    // (1918-26), which aren't NHL games here; only games we carry count.
    const known = new Set(rows.map((r) => Number(r.game_id)));
    for (const [k, log] of logs) {
      if (!log) continue;
      const pid = k.split("|")[0];
      for (const gid of log) if (known.has(gid) && !boxKeys.has(`${gid}|${pid}`)) totals.logOnly++;
    }
    await db.query("begin");
    const mark = async (pairs: [number, number][], value: boolean) => {
      for (let i = 0; i < pairs.length; i += 5000) {
        const chunk = pairs.slice(i, i + 5000);
        await db.query(
          `update nhl_skater_games s set played = $3 from unnest($1::int[], $2::int[]) k(game_id, player_id)
           where s.game_id = k.game_id and s.player_id = k.player_id`,
          [chunk.map((c) => c[0]), chunk.map((c) => c[1]), value],
        );
      }
    };
    await mark(played, true);
    await mark(notPlayed, false);
    if (conflictGames.size) {
      await db.query(
        // Only games that passed every other check: a game already failing
        // keeps its original reason.
        `update nhl_box_checks set ok = false, sog_ok = false, reason = 'appearance: a player the NHL says didn''t play has stats in the box' where game_id = any($1) and ok`,
        [[...conflictGames]],
      );
    }
    await db.query("commit");
    totals.played += played.length;
    totals.notPlayed += notPlayed.length;
    totals.conflicts += conflictGames.size;
    console.log(`${season}: ${played.length} played, ${notPlayed.length} didn't${conflictGames.size ? `, ${conflictGames.size} games with conflicts` : ""}`);
  }
  await db.end();
  console.log(`\nRows: ${totals.played} played, ${totals.notPlayed} didn't play, ${totals.unmarked} unmarked (no log). Games with a conflict: ${totals.conflicts}. Logged games without a box row: ${totals.logOnly}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
