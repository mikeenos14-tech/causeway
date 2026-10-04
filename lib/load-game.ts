import { pool } from "./db";
import { gameRows, writeGameRows, writeStandings } from "./game-rows";

// Loads one finished game into the site's tables the moment the NHL calls
// it final: the game, every player's line, and the league standings. Run
// by the site itself (the live scoreboard's endpoint when it sees a final,
// and a cron every few minutes), so a result is on the site about a minute
// after the horn instead of waiting for the hourly GitHub job, which
// dropped eight hours of runs on 2026-10-03.
//
// The hourly job (scripts/backfill-season.ts) still runs: it writes the
// same rows through the same code (lib/game-rows.ts), re-checks the last
// 48 hours for NHL corrections, and does what this doesn't: special-teams
// stats, recaps, the stats history, team identities, and a playoff game's
// series link (a playoff game loaded here gets its series on the next
// hourly run).

const API = "https://api-web.nhle.com/v1";

/* eslint-disable @typescript-eslint/no-explicit-any -- the NHL feed is untyped JSON */
async function get(url: string, timeoutMs = 10_000): Promise<any> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return res.json();
}

export type LoadResult =
  | { status: "loaded" | "rechecked"; gameId: number; teams: string[]; notes: string[] }
  | { status: "skipped"; gameId: number; reason: string };

export async function loadFinishedGame(gameId: number): Promise<LoadResult> {
  const box = await get(`${API}/gamecenter/${gameId}/boxscore`);
  if (!["FINAL", "OFF"].includes(box.gameState)) return { status: "skipped", gameId, reason: `not final (${box.gameState})` };
  if (box.gameType !== 2 && box.gameType !== 3) return { status: "skipped", gameId, reason: `game type ${box.gameType}` };
  const seasonId = String(box.season);

  const db = await pool.connect();
  try {
    await db.query("begin");
    // One loader per game at a time (the live endpoint and the cron can
    // both see the same final); the other just skips.
    const { rows: [lock] } = await db.query(`select pg_try_advisory_xact_lock(hashtext('load-game'), $1) as ok`, [gameId % 2147483647]);
    if (!lock.ok) {
      await db.query("rollback");
      return { status: "skipped", gameId, reason: "another load is running" };
    }
    const { rows: teams } = await db.query(`select id, abbrev from teams where id = any($1::int[])`, [[box.homeTeam.id, box.awayTeam.id]]);
    const { rows: season } = await db.query(`select 1 from seasons where id = $1`, [seasonId]);
    if (teams.length !== 2 || !season.length) {
      await db.query("rollback");
      return { status: "skipped", gameId, reason: "team or season not set up yet (the hourly job does that)" };
    }
    const { rows: existing } = await db.query(`select 1 from games where id = $1`, [gameId]);

    const rows = gameRows(seasonId, box, box);
    // Players: a new face gets his real bio from the NHL (never the box
    // score's "A. Smits"); everyone gets this season's team and number.
    const ids = [...new Set(rows.players.map((x) => x.p.playerId))];
    const { rows: known } = await db.query(`select id from players where id = any($1::int[])`, [ids]);
    const knownIds = new Set(known.map((r) => Number(r.id)));
    for (const { p, teamId } of rows.players) {
      if (!knownIds.has(p.playerId)) {
        const bio = await get(`${API}/player/${p.playerId}/landing`).catch(() => null);
        await db.query(
          `insert into players (id, full_name, position, shoots_catches, birth_date, birth_country, height_cm, weight_kg)
           values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do nothing`,
          [
            p.playerId,
            bio ? `${bio.firstName.default} ${bio.lastName.default}` : p.name.default,
            p.position === "G" ? "G" : (bio?.position ?? p.position),
            bio?.shootsCatches ?? null,
            bio?.birthDate ?? null,
            bio?.birthCountry ?? null,
            bio?.heightInCentimeters ?? null,
            bio?.weightInKilograms ?? null,
          ],
        );
        knownIds.add(p.playerId);
      }
      await db.query(
        `insert into player_team_seasons (player_id, team_id, season_id, jersey_number) values ($1, $2, $3, $4)
         on conflict (player_id, team_id, season_id) do update set jersey_number = excluded.jersey_number`,
        [p.playerId, teamId, seasonId, p.sweaterNumber ?? null],
      );
    }
    const notes = await writeGameRows(db, [rows], existing.length ? new Set([gameId]) : new Set());

    // Standings, for the newest season (as the hourly job does it).
    const { rows: [newest] } = await db.query(`select max(id) as id from seasons`);
    if (newest?.id === seasonId && box.gameType === 2) {
      const standings = await get(`${API}/standings/now`);
      const { rows: active } = await db.query(`select id, abbrev from teams where is_active`);
      const { skipped } = await writeStandings(db, seasonId, standings.standings ?? [], new Map(active.map((r) => [r.abbrev, Number(r.id)])));
      if (skipped.length) notes.push(`standings: no team id for ${skipped.join(", ")}`);
    }
    await db.query("commit");
    return { status: existing.length ? "rechecked" : "loaded", gameId, teams: teams.map((t) => t.abbrev), notes };
  } catch (e) {
    await db.query("rollback").catch(() => {});
    throw e;
  } finally {
    db.release();
  }
}

// The pages a finished game changes, refreshed right away rather than on
// their own timers (60-300 s).
export function pathsForGame(gameId: number, teams: string[]): string[] {
  return ["/", "/schedule", "/standings", `/games/${gameId}`, ...teams.flatMap((t) => [`/teams/${t}`, `/teams/${t}/league`])];
}

// Games the NHL calls final on these dates (its local calendar) that the
// site doesn't have yet, or loaded more than 30 minutes ago within the
// last 12 hours (to take the NHL's first corrections without waiting for
// the hourly job).
export async function finishedGames(dates: string[]): Promise<{ id: number; start: string; loadedAt: Date | null }[]> {
  const out: { id: number; start: string; loadedAt: Date | null }[] = [];
  for (const date of dates) {
    const day = await get(`${API}/score/${date}`);
    for (const g of day.games ?? []) {
      if (["FINAL", "OFF"].includes(g.gameState) && (g.gameType === 2 || g.gameType === 3)) out.push({ id: g.id, start: g.startTimeUTC, loadedAt: null });
    }
  }
  if (!out.length) return out;
  const { rows } = await pool.query(`select id, updated_at from games where id = any($1::int[])`, [out.map((g) => g.id)]);
  const loaded = new Map(rows.map((r) => [Number(r.id), r.updated_at as Date]));
  for (const g of out) g.loadedAt = loaded.get(g.id) ?? null;
  return out;
}

export function needsLoad(g: { start: string; loadedAt: Date | null }, now = Date.now()): boolean {
  if (!g.loadedAt) return true;
  return now - Date.parse(g.start) < 12 * 3600_000 && now - g.loadedAt.getTime() > 30 * 60_000;
}

// The NHL's calendar dates covering "tonight" and "last night" from any
// time of day (its dates are local; a West Coast game ends after midnight
// UTC).
export function recentNhlDates(now = new Date()): string[] {
  const d = (ms: number) => new Date(now.getTime() - ms).toISOString().slice(0, 10);
  return [...new Set([d(8 * 3600_000), d(32 * 3600_000)])];
}

export async function recordHeartbeat(name: string, ok: boolean, detail: string) {
  await pool.query(
    `insert into ops_heartbeats (name, at, ok, detail) values ($1, now(), $2, $3)
     on conflict (name) do update set at = excluded.at, ok = excluded.ok, detail = excluded.detail`,
    [name, ok, detail.slice(0, 2000)],
  );
}
