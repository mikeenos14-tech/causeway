// Regenerates stored recaps (and rejected attempts) for Boston games
// through the current pipeline — for when the recap narrator itself
// changes, as it did on 2026-09-28 when recaps moved from "final score
// only" to a verified fact sheet (lib/game-facts.ts). Games whose
// significance checks now find something (e.g. the new scoring-feat check)
// come back as highlights instead, via the normal generate-highlights flow.
//
// Games that already have a 'highlights' narrative are left to
// scripts/renarrate-changed-highlights.ts.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/regenerate-recaps.ts                  (dry run: counts)
//   npx tsx --env-file=.env.local scripts/regenerate-recaps.ts --apply --limit 10
//   npx tsx --env-file=.env.local scripts/regenerate-recaps.ts --apply           (all)

import { Client } from "pg";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { TARGET_TEAM_ABBREV } from "../lib/significance-checks";

const APPLY = process.argv.includes("--apply");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : null;

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const { rows } = await client.query(
    `select n.game_id, n.kind, n.headline, n.body, n.facts_json, n.source, n.model_version, n.generated_at
     from narratives n
     join games g on g.id = n.game_id
     join teams ht on ht.id = g.home_team_id
     join teams at on at.id = g.away_team_id
     where n.kind in ('recap', 'rejected') and (ht.abbrev = $1 or at.abbrev = $1)
       and not exists (select 1 from narratives h where h.game_id = n.game_id and h.kind = 'highlights')
     order by g.game_date desc`,
    [TARGET_TEAM_ABBREV],
  );
  const targets = LIMIT ? rows.slice(0, LIMIT) : rows;
  console.log(`${rows.length} ${TARGET_TEAM_ABBREV} games have a recap or rejected narration; ${targets.length} selected (newest first).`);
  if (!APPLY) {
    console.log("Dry run. Re-run with --apply [--limit N].");
    await client.end();
    return;
  }

  mkdirSync("scratch", { recursive: true });
  const backup = `scratch/recaps-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(backup, JSON.stringify(targets, null, 2));
  console.log(`Backed up ${targets.length} rows to ${backup}`);

  const ids = [...new Set(targets.map((r) => r.game_id))];
  await client.query(`delete from narratives where kind in ('recap', 'rejected') and game_id = any($1::int[])`, [ids]);
  await client.end();

  for (let i = 0; i < ids.length; i += 25) {
    execFileSync("npx", ["tsx", "scripts/generate-highlights.ts", ...ids.slice(i, i + 25).map(String)], { stdio: "inherit", env: process.env });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
