// Fills skater_game_stats.ixg / icorsi / on_ice_xg_pct / on_ice_corsi_pct
// from MoneyPuck's per-season "skaters game by game" files — the
// individual-player equivalent of backfill-moneypuck.ts's team-level xG/
// Corsi. Same verified mapping this session already proved for the team
// file: MoneyPuck's playerId IS the NHL's own player id (Pastrnak's row
// used id 8477956, matching our players.id exactly), and gameId is the
// NHL's own game id — both direct joins, no fuzzy matching.
//
// Scoped to Bruins players only, not the full league: every current UI
// that would show this (roster table, player pages) is Bruins-specific,
// and download cost is the same either way (each season file covers
// every team regardless of what we keep), so this just means fewer,
// faster DB writes for the rows that actually matter right now.
//
// One season at a time, not the multi-season historical bundle — a
// single season's file is already ~23MB/236k rows for the full league;
// downloading and holding the entire 2008-2024 bundle in memory to keep
// 3% of it (one team) isn't worth it when per-season files exist.
//
// Usage: npx tsx scripts/backfill-moneypuck-players.ts [startYear] [endYear]
// Defaults to 2008 (MoneyPuck's own real coverage start, confirmed live
// against their team-level file earlier) through the current year.

import { Client } from "pg";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execFileSync } from "child_process";

// The zip's internal path isn't consistent across years — confirmed live:
// 2025.zip has a flat "2025.csv" at its root, 2008.zip nests it under
// "my stuff/var/www/html/moneypuck/summaryData/seasonPlayersSummary/
// skaters/2008.csv". Don't assume either shape; just find whatever .csv
// `unzip` actually produced.
function findCsv(dir: string): string {
  const out = execFileSync("find", [dir, "-name", "*.csv"]).toString().trim().split("\n").filter(Boolean);
  if (out.length === 0) throw new Error(`No .csv file found after extracting ${dir}`);
  return out[0];
}

const TEAM_ABBREV = "BOS";
const FLAT_ALIASES: Record<string, string> = { "L.A": "LAK", "N.J": "NJD", "S.J": "SJS", "T.B": "TBL" };

function seasonUrl(year: number) {
  return `https://peter-tanner.com/moneypuck/downloads/seasonPlayersSummary/skaters/${year}.zip`;
}

async function processSeason(client: Client, year: number, resolveTeamId: (abbrev: string, seasonYear: number) => number | null) {
  console.log(`\n=== ${year} ===`);
  const res = await fetch(seasonUrl(year));
  if (!res.ok) {
    console.log(`  ${res.status} — no file for this year, skipping`);
    return { written: 0, skipped: 0 };
  }
  const tmpDir = mkdtempSync(join(tmpdir(), "mp-players-"));
  const zipPath = join(tmpDir, `${year}.zip`);
  writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  execFileSync("unzip", ["-o", "-q", zipPath, "-d", tmpDir]);
  const csvPath = findCsv(tmpDir);
  const text = readFileSync(csvPath, "utf-8");
  rmSync(tmpDir, { recursive: true, force: true });

  const lines = text.split("\n");
  const header = lines[0].split(",");
  const col = (name: string) => {
    const idx = header.indexOf(name);
    if (idx === -1) throw new Error(`Column ${name} not found in ${year} skaters CSV header`);
    return idx;
  };
  const iPlayerId = col("playerId");
  const iGameId = col("gameId");
  const iTeam = col("playerTeam");
  const iSituation = col("situation");
  const iIxg = col("I_F_xGoals");
  const iIcorsi = col("I_F_shotAttempts");
  const iOnIceXgPct = col("onIce_xGoalsPercentage");
  const iOnIceCorsiPct = col("onIce_corsiPercentage");

  type Row = { gameId: number; playerId: number; teamId: number; ixg: number; icorsi: number; onIceXgPct: number | null; onIceCorsiPct: number | null };
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cells = line.split(",");
    if (cells[iSituation] !== "all") continue;
    if (cells[iTeam] !== TEAM_ABBREV) continue;
    const teamId = resolveTeamId(cells[iTeam], year);
    if (!teamId) continue;
    rows.push({
      gameId: Number(cells[iGameId]),
      playerId: Number(cells[iPlayerId]),
      teamId,
      ixg: Number(cells[iIxg]),
      icorsi: Number(cells[iIcorsi]),
      onIceXgPct: cells[iOnIceXgPct] !== "" ? Number(cells[iOnIceXgPct]) : null,
      onIceCorsiPct: cells[iOnIceCorsiPct] !== "" ? Number(cells[iOnIceCorsiPct]) : null,
    });
  }
  console.log(`  ${rows.length} ${TEAM_ABBREV} skater-game rows (situation=all)`);

  // Only rows whose game and player already exist in our database — a
  // MoneyPuck row for a player we haven't loaded (e.g. a call-up with no
  // games in our own skater_game_stats yet) would violate the foreign key.
  const { rows: existing } = await client.query(
    `select sgs.game_id, sgs.player_id from skater_game_stats sgs
     join games g on g.id = sgs.game_id
     where g.season_id = $1 and sgs.team_id = $2`,
    [`${year}${year + 1}`, rows[0]?.teamId ?? -1],
  );
  const existingSet = new Set(existing.map((r) => `${r.game_id}:${r.player_id}`));
  const matched = rows.filter((r) => existingSet.has(`${r.gameId}:${r.playerId}`));
  console.log(`  ${matched.length} match an existing skater_game_stats row`);

  const BATCH_SIZE = 500;
  let written = 0;
  for (let i = 0; i < matched.length; i += BATCH_SIZE) {
    const batch = matched.slice(i, i + BATCH_SIZE);
    const values: unknown[] = [];
    const placeholders = batch.map((r, j) => {
      const base = j * 7;
      // team_id here is a required-but-discarded placeholder: every row in
      // `matched` was already confirmed to exist (via existingSet above),
      // so this always hits the ON CONFLICT branch, which never touches
      // team_id — the row's real team_id (set by the NHL API backfill)
      // is left exactly as it was.
      values.push(r.gameId, r.playerId, r.teamId, r.ixg, r.icorsi, r.onIceXgPct, r.onIceCorsiPct);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
    });
    // Partial-column upsert on the existing row — never touches goals,
    // assists, shots, etc. (those come from the NHL API backfill).
    await client.query(
      `insert into skater_game_stats (game_id, player_id, team_id, ixg, icorsi, on_ice_xg_pct, on_ice_corsi_pct)
       values ${placeholders.join(", ")}
       on conflict (game_id, player_id) do update set
         ixg = excluded.ixg, icorsi = excluded.icorsi,
         on_ice_xg_pct = excluded.on_ice_xg_pct, on_ice_corsi_pct = excluded.on_ice_corsi_pct,
         updated_at = now()`,
      values,
    );
    written += batch.length;
  }
  console.log(`  ${written} rows written`);
  return { written, skipped: rows.length - matched.length };
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  client.on("error", (err) => {
    console.error(`pg client error (connection dropped): ${err.message}`);
  });
  await client.connect();

  try {
    const startYear = Number(process.argv[2]) || 2008;
    const endYear = Number(process.argv[3]) || new Date().getUTCFullYear();

    const { rows: lineage } = await client.query(
      `select id, name from teams where name in ('Phoenix Coyotes', 'Arizona Coyotes', 'Utah Hockey Club', 'Utah Mammoth')`,
    );
    const byName = new Map(lineage.map((r) => [r.name, r.id]));
    const { rows: teams } = await client.query(`select id, abbrev from teams where is_active = true`);
    const activeIdByAbbrev = new Map<string, number>(teams.map((t) => [t.abbrev, t.id]));

    function resolveTeamId(moneypuckAbbrev: string, seasonYear: number): number | null {
      if (moneypuckAbbrev === "ARI") return seasonYear < 2014 ? (byName.get("Phoenix Coyotes") ?? null) : (byName.get("Arizona Coyotes") ?? null);
      if (moneypuckAbbrev === "UTA") return seasonYear < 2025 ? (byName.get("Utah Hockey Club") ?? null) : (byName.get("Utah Mammoth") ?? null);
      const abbrev = FLAT_ALIASES[moneypuckAbbrev] ?? moneypuckAbbrev;
      return activeIdByAbbrev.get(abbrev) ?? null;
    }

    let totalWritten = 0;
    for (let year = startYear; year <= endYear; year++) {
      const { written } = await processSeason(client, year, resolveTeamId);
      totalWritten += written;
    }
    console.log(`\nDone. ${totalWritten} total rows written across ${startYear}-${endYear}.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
