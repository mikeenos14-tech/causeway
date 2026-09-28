// Keeps published highlights in step with the significance checks. A stored
// 'highlights' narrative is only as true as the checks that produced its
// facts; when a check is corrected, older narratives built on the buggy
// version stay live. Found twice on 2026-09-28: career milestones that
// counted playoff games ("1000th career point" for a player at 914), and
// point streaks that ran across seasons and playoffs ("5-game streak
// ended" on opening night, for a streak from the previous April).
//
// Re-runs today's checks for every stored highlight and compares facts.
// Dry run lists what changed. --apply backs up the affected rows to
// scratch/, removes them, and regenerates those games through the normal
// pipeline (scripts/generate-highlights.ts): a game whose facts disappear
// falls back to a recap, the same as any unremarkable game.
//
// Run after any change to lib/significance-checks.ts.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/renarrate-changed-highlights.ts          (dry run)
//   npx tsx --env-file=.env.local scripts/renarrate-changed-highlights.ts --apply

import { Client } from "pg";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { runSignificanceChecks } from "../lib/significance-checks";

const APPLY = process.argv.includes("--apply");

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const { rows } = await client.query(
    `select game_id, headline, body, facts_json, source, model_version, generated_at
     from narratives where kind = 'highlights' order by game_id`,
  );

  const changed: typeof rows = [];
  for (const r of rows) {
    const stored = ((r.facts_json ?? []) as { fact: string }[]).map((f) => f.fact).sort();
    const now = (await runSignificanceChecks(client, r.game_id)).map((f) => f.fact).sort();
    if (JSON.stringify(stored) !== JSON.stringify(now)) {
      changed.push(r);
      console.log(`${r.game_id}\n  was: ${stored.join(" | ") || "(none)"}\n  now: ${now.join(" | ") || "(none — becomes a recap)"}`);
    }
  }
  console.log(`\n${changed.length} of ${rows.length} stored highlights no longer match the current checks.`);

  if (!APPLY || changed.length === 0) {
    if (!APPLY) console.log("Dry run. Re-run with --apply to back up, remove, and regenerate them.");
    await client.end();
    return;
  }

  mkdirSync("scratch", { recursive: true });
  const backup = `scratch/highlights-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(backup, JSON.stringify(changed, null, 2));
  console.log(`Backed up ${changed.length} rows to ${backup}`);

  const ids = changed.map((r) => r.game_id);
  // Also clear any stale 'rejected' marker for these games, or the
  // generator would treat them as already attempted and skip them.
  await client.query(`delete from narratives where kind in ('highlights', 'rejected') and game_id = any($1::int[])`, [ids]);
  await client.end();

  for (let i = 0; i < ids.length; i += 25) {
    execFileSync("npx", ["tsx", "scripts/generate-highlights.ts", ...ids.slice(i, i + 25).map(String)], { stdio: "inherit", env: process.env });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
