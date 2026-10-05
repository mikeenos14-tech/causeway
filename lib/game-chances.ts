import { pool } from "./db";
import type { ChancesData } from "@/components/Chances";

// A finished game's stored chances (game_chances, from lib/xg.ts), or null
// (before 2009-10, or not built yet).
export async function getGameChances(gameId: number): Promise<ChancesData | null> {
  const { rows } = await pool.query(
    `select home_xg, away_xg, by_period, home_shots, away_shots, deserved_home from game_chances where game_id = $1`,
    [gameId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    home: Number(r.home_xg),
    away: Number(r.away_xg),
    byPeriod: r.by_period,
    shots: { home: Number(r.home_shots), away: Number(r.away_shots) },
    deservedHome: Number(r.deserved_home),
  };
}
