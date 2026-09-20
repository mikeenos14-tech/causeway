// Fills team_game_stats.xg_for / xg_against / corsi_for / corsi_against
// from MoneyPuck's public "all teams, game by game" CSV — a single static
// file, not an API, so none of the rate-limiting concerns from
// backfill-team-game-stats.ts apply here. Free for non-commercial use;
// MoneyPuck requires visible attribution wherever this data is shown (see
// the credit line added alongside it in the UI).
//
// gameId in this file IS the NHL's own official game id — verified live
// against a known game (2025020005, BOS @ WSH) before writing this: same
// id, and goalsFor/goalsAgainst in the "all" situation row matched our
// own stored 3-1 final exactly. That's what makes this a direct join
// instead of a fuzzy date/matchup match.
//
// Three real team-identity wrinkles, all confirmed by inspecting the
// actual file rather than assumed:
//  - Older rows spell some teams differently: L.A/N.J/S.J/T.B instead of
//    LAK/NJD/SJS/TBL used elsewhere in the same file.
//  - MoneyPuck labels every Coyotes season "ARI," including the
//    Phoenix-era seasons our DB tracks as a separate PHX team row.
//  - MoneyPuck labels every Utah season "UTA," including 2024-25 (Utah
//    Hockey Club), which our DB tracks as a separate team row from
//    2025-26 (Utah Mammoth) — the same rename our UTA abbrev collision
//    fix (season-series feature) already had to account for.
//
// Usage: npx tsx scripts/backfill-moneypuck.ts

import { Client } from "pg";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const CSV_URL = "https://moneypuck.com/moneypuck/playerData/careers/gameByGame/all_teams.csv";

const FLAT_ALIASES: Record<string, string> = {
  "L.A": "LAK",
  "N.J": "NJD",
  "S.J": "SJS",
  "T.B": "TBL",
};

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  client.on("error", (err) => {
    console.error(`pg client error (connection likely dropped, next query will surface it): ${err.message}`);
  });
  await client.connect();

  try {
    // Resolve the two season-split franchises by exact name (not abbrev —
    // that's the whole reason this needs special-casing at all) once,
    // from the database's own lineage data instead of hardcoded ids.
    const { rows: lineage } = await client.query(
      `select id, name from teams where name in ('Phoenix Coyotes', 'Arizona Coyotes', 'Utah Hockey Club', 'Utah Mammoth')`,
    );
    const byName = new Map(lineage.map((r) => [r.name, r.id]));
    const phxId = byName.get("Phoenix Coyotes");
    const ariId = byName.get("Arizona Coyotes");
    const utaHcId = byName.get("Utah Hockey Club");
    const utaMammothId = byName.get("Utah Mammoth");
    if (!phxId || !ariId || !utaHcId || !utaMammothId) {
      throw new Error("Expected lineage teams (Phoenix Coyotes, Arizona Coyotes, Utah Hockey Club, Utah Mammoth) not all found.");
    }

    const { rows: teams } = await client.query(`select id, abbrev from teams where is_active = true`);
    const activeIdByAbbrev = new Map<string, number>(teams.map((t) => [t.abbrev, t.id]));

    function resolveTeamId(moneypuckAbbrev: string, seasonYear: number): number | null {
      if (moneypuckAbbrev === "ARI") return seasonYear < 2014 ? phxId! : ariId!;
      if (moneypuckAbbrev === "UTA") return seasonYear < 2025 ? utaHcId! : utaMammothId!;
      const abbrev = FLAT_ALIASES[moneypuckAbbrev] ?? moneypuckAbbrev;
      return activeIdByAbbrev.get(abbrev) ?? null;
    }

    console.log("Downloading MoneyPuck team game-by-game data (~120MB)...");
    const res = await fetch(CSV_URL);
    if (!res.ok) throw new Error(`${res.status} fetching ${CSV_URL}`);
    const tmpDir = mkdtempSync(join(tmpdir(), "moneypuck-"));
    const csvPath = join(tmpDir, "all_teams.csv");
    writeFileSync(csvPath, Buffer.from(await res.arrayBuffer()));
    console.log(`Downloaded to ${csvPath}`);

    const text = readFileSync(csvPath, "utf-8");
    const lines = text.split("\n");
    const header = lines[0].split(",");
    const col = (name: string) => {
      const idx = header.indexOf(name);
      if (idx === -1) throw new Error(`Column ${name} not found in MoneyPuck CSV header`);
      return idx;
    };
    const iTeam = col("team");
    const iSeason = col("season");
    const iGameId = col("gameId");
    const iSituation = col("situation");
    const iXGoalsFor = col("xGoalsFor");
    const iXGoalsAgainst = col("xGoalsAgainst");
    const iShotAttemptsFor = col("shotAttemptsFor");
    const iShotAttemptsAgainst = col("shotAttemptsAgainst");

    type Row = { gameId: number; teamId: number; xgFor: number; xgAgainst: number; corsiFor: number; corsiAgainst: number };
    const rows: Row[] = [];
    let skippedUnresolved = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const cells = line.split(",");
      if (cells[iSituation] !== "all") continue;
      const seasonYear = Number(cells[iSeason]);
      const teamId = resolveTeamId(cells[iTeam], seasonYear);
      if (!teamId) {
        skippedUnresolved++;
        continue;
      }
      rows.push({
        gameId: Number(cells[iGameId]),
        teamId,
        xgFor: Number(cells[iXGoalsFor]),
        xgAgainst: Number(cells[iXGoalsAgainst]),
        corsiFor: Number(cells[iShotAttemptsFor]),
        corsiAgainst: Number(cells[iShotAttemptsAgainst]),
      });
    }
    console.log(`Parsed ${rows.length} team-game rows (situation=all), ${skippedUnresolved} skipped (unresolved team).`);

    rmSync(tmpDir, { recursive: true, force: true });

    // Only touch games we actually have — a MoneyPuck row for a game
    // outside our loaded range would otherwise insert a team_game_stats
    // row with no matching games row and violate the foreign key.
    const { rows: ourGameIds } = await client.query(`select id from games`);
    const ourGameIdSet = new Set(ourGameIds.map((r) => r.id));
    const matched = rows.filter((r) => ourGameIdSet.has(r.gameId));
    console.log(`${matched.length} of those rows match a game already in our database.`);

    const BATCH_SIZE = 500;
    let written = 0;
    for (let i = 0; i < matched.length; i += BATCH_SIZE) {
      const batch = matched.slice(i, i + BATCH_SIZE);
      const values: unknown[] = [];
      const placeholders = batch.map((r, j) => {
        const base = j * 6;
        values.push(r.gameId, r.teamId, r.xgFor, r.xgAgainst, r.corsiFor, r.corsiAgainst);
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, 'moneypuck')`;
      });
      // Partial-column upsert — this never touches shots_on_goal, pp_goals,
      // etc. (backfill-team-game-stats.ts's columns), and that script's
      // own insert never touches these, so the two backfills are safe to
      // run in either order or concurrently.
      await client.query(
        `insert into team_game_stats (game_id, team_id, xg_for, xg_against, corsi_for, corsi_against, source)
         values ${placeholders.join(", ")}
         on conflict (game_id, team_id) do update set
           xg_for = excluded.xg_for, xg_against = excluded.xg_against,
           corsi_for = excluded.corsi_for, corsi_against = excluded.corsi_against,
           updated_at = now()`,
        values,
      );
      written += batch.length;
      if ((i / BATCH_SIZE) % 10 === 0) console.log(`... ${written}/${matched.length} written`);
    }

    console.log(`\nDone. ${written} team-game xG/Corsi rows written.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
