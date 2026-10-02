import { pool } from "./db";
import type { WpParams, WpCell } from "./stats/wp";

// The stored win probability model (scripts/stats/build-wp.ts): the newest
// version's parameters and correction table, cached per server instance.

export type WpMetrics = { logLoss: number; noStrengthLogLoss: number; pregameOnlyLogLoss: number; calibrationErrorPts: number; heldOutGames: number; heldOutStates: number };
type WpModel = { version: string; params: WpParams; table: Map<string, WpCell>; metrics: WpMetrics };

let cache: (WpModel & { at: number }) | null = null;

export async function getWpModel(): Promise<WpModel | null> {
  if (cache && Date.now() - cache.at < 3600_000) return cache;
  const { rows: [m] } = await pool.query(`select model_version, params, metrics from wp_model order by built_at desc limit 1`);
  if (!m) return null;
  const { rows } = await pool.query(`select cell, n, win, loss, model_win, model_loss from wp_cells where model_version = $1`, [m.model_version]);
  const table = new Map<string, WpCell>(rows.map((r) => [r.cell, { n: r.n, win: r.win, loss: r.loss, modelWin: r.model_win, modelLoss: r.model_loss }]));
  cache = { version: m.model_version, params: m.params, table, metrics: m.metrics, at: Date.now() };
  return cache;
}
