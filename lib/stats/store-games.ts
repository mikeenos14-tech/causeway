// Saving parsed games into the nhl_* tables, shared by the one-time
// backfill (scripts/stats/load-nhl-history.ts) and the hourly ingest
// (scripts/stats/ingest-recent-games.ts) so both write identically. Each
// game's events are replaced wholesale, so re-saving a game is safe.

import type { Client } from "pg";
import type { ParsedGame } from "./parse-game";

// Multi-row insert in chunks (Postgres caps a statement at 65,535 params).
export async function insertRows(client: Client, table: string, cols: string[], rows: unknown[][], conflict = "") {
  const per = Math.max(1, Math.floor(60000 / cols.length));
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    const values = chunk.map((_, r) => `(${cols.map((_, c) => `$${r * cols.length + c + 1}`).join(",")})`).join(",");
    await client.query(`insert into ${table} (${cols.join(",")}) values ${values} ${conflict}`, chunk.flat());
  }
}

export async function storeParsedGames(client: Client, parsed: ParsedGame[]): Promise<void> {
  if (parsed.length === 0) return;
  await client.query("begin");
  try {
    const players = new Map(parsed.flatMap((p) => p.players).map((pl) => [pl.id, pl]));
    await insertRows(client, "nhl_players", ["id", "full_name", "position"], [...players.values()].map((p) => [p.id, p.full_name, p.position]), "on conflict (id) do update set full_name = excluded.full_name, position = coalesce(excluded.position, nhl_players.position)");

    const gcols = Object.keys(parsed[0].game);
    await insertRows(
      client,
      "nhl_games",
      gcols,
      parsed.map((p) => gcols.map((c) => p.game[c as keyof ParsedGame["game"]])),
      `on conflict (id) do update set ${gcols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", ")}, loaded_at = now()`,
    );
    const ids = parsed.map((p) => p.game.id);
    for (const t of ["nhl_goal_events", "nhl_penalty_events", "nhl_period_scores"]) await client.query(`delete from ${t} where game_id = any($1)`, [ids]);

    const goalCols = ["event_id", "period", "period_type", "time_in_period_sec", "time_elapsed_sec", "team_id", "scorer_id", "assist1_id", "assist2_id", "strength", "empty_net", "situation_code", "score_before_home", "score_before_away"] as const;
    await insertRows(client, "nhl_goal_events", ["game_id", ...goalCols], parsed.flatMap((p) => p.goals.map((g) => [p.game.id, ...goalCols.map((c) => g[c])])), "on conflict do nothing");
    const penCols = ["event_id", "period", "period_type", "time_in_period_sec", "time_elapsed_sec", "team_id", "player_id", "drawn_by_id", "served_by_id", "minutes", "type_code", "infraction", "situation_code"] as const;
    // The feed occasionally repeats an event id; keep the first.
    await insertRows(client, "nhl_penalty_events", ["game_id", ...penCols], parsed.flatMap((p) => p.penalties.map((x) => [p.game.id, ...penCols.map((c) => x[c])])), "on conflict do nothing");
    const perCols = ["period", "period_type", "home_goals", "away_goals", "home_shots", "away_shots"] as const;
    await insertRows(client, "nhl_period_scores", ["game_id", ...perCols], parsed.flatMap((p) => p.periods.map((x) => [p.game.id, ...perCols.map((c) => x[c])])), "on conflict do nothing");
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  }
}
