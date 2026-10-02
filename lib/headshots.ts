import { pool } from "./db";

// Official NHL headshot URLs (player_headshots, synced hourly from current
// rosters) for a set of players, keyed by player id. Players with no photo
// on file are simply absent; <Headshot> shows their initials instead.
export async function getHeadshots(ids: number[]): Promise<Record<number, string>> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id)))];
  if (unique.length === 0) return {};
  const { rows } = await pool.query(`select player_id, url from player_headshots where player_id = any($1::int[])`, [unique]);
  return Object.fromEntries(rows.map((r) => [Number(r.player_id), r.url as string]));
}
