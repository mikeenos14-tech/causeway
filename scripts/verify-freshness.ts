// Freshness invariants — verify-team.ts checks that the data is CORRECT;
// this checks that it's CURRENT. Without it, a stalled refresh (an NHL API
// change, a load that keeps failing, a job that quietly stops) would leave
// the site showing yesterday forever while every correctness check still
// passes.
//
//   1. Every NHL regular-season or playoff game that went final more than
//      FRESHNESS_HOURS ago (within the last two days) is in our database.
//   2. Every such Boston game has a narration attempt stored (a recap,
//      a highlight, or a rejection marker).
//
// Run by scripts/verify-all.ts at the end of every hourly refresh.

import type { Client } from "pg";

const API = "https://api-web.nhle.com/v1";
const FRESHNESS_HOURS = 3;
const LOOKBACK_HOURS = 48;

type ApiGame = { id: number; gameType: number; gameState: string; startTimeUTC: string; homeTeam: { abbrev: string }; awayTeam: { abbrev: string } };

export async function checkFreshness(client: Client, targetAbbrev = "BOS", now = Date.now()): Promise<string[]> {
  const issues: string[] = [];
  const from = new Date(now - LOOKBACK_HOURS * 3600 * 1000).toISOString().slice(0, 10);
  let games: ApiGame[];
  try {
    const res = await fetch(`${API}/schedule/${from}`);
    if (!res.ok) return [`Freshness check couldn't reach the NHL schedule API (HTTP ${res.status}).`];
    const data = await res.json();
    games = (data.gameWeek ?? []).flatMap((d: { games: ApiGame[] }) => d.games);
  } catch (err) {
    return [`Freshness check couldn't reach the NHL schedule API: ${err instanceof Error ? err.message : String(err)}`];
  }

  // Final games whose start was long enough ago that the hourly refresh has
  // had FRESHNESS_HOURS (after a ~3h game) to load them.
  const cutoff = now - (FRESHNESS_HOURS + 3) * 3600 * 1000;
  const due = games.filter(
    (g) =>
      (g.gameType === 2 || g.gameType === 3) &&
      (g.gameState === "FINAL" || g.gameState === "OFF") &&
      Date.parse(g.startTimeUTC) < cutoff &&
      Date.parse(g.startTimeUTC) > now - LOOKBACK_HOURS * 3600 * 1000,
  );
  if (due.length === 0) return issues;

  const { rows } = await client.query(
    `select g.id, exists (select 1 from narratives n where n.game_id = g.id) as narrated
     from games g where g.id = any($1::bigint[])`,
    [due.map((g) => g.id)],
  );
  const loaded = new Map(rows.map((r) => [Number(r.id), r.narrated as boolean]));
  for (const g of due) {
    const label = `${g.awayTeam.abbrev} @ ${g.homeTeam.abbrev} (${g.id}, started ${g.startTimeUTC})`;
    if (!loaded.has(g.id)) {
      issues.push(`Not loaded: ${label} went final more than ${FRESHNESS_HOURS}h ago but isn't in the database.`);
    } else if ((g.homeTeam.abbrev === targetAbbrev || g.awayTeam.abbrev === targetAbbrev) && !loaded.get(g.id)) {
      issues.push(`No narration: ${label} is loaded but has no recap, highlight, or rejection stored.`);
    }
  }
  return issues;
}
