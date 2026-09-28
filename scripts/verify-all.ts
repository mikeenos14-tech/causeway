// Runs every data-integrity invariant in verify-team.ts for all active
// teams and exits non-zero if any fail — the final step of the hourly
// refresh (.github/workflows/refresh-data.yml), so a regression like the
// 2026-09-28 goalie bugs (OT losses stored as null decisions, relief
// appearances credited as shutouts) fails a run within the hour instead of
// waiting for someone to notice. A failed scheduled run emails the account
// that last edited the workflow.
//
// Usage: npx tsx --env-file=.env.local scripts/verify-all.ts

import { Client } from "pg";
import { verifyTeam } from "./verify-team";
import { checkFreshness } from "./verify-freshness";

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const { rows: teams } = await client.query(`select abbrev from teams where is_active order by abbrev`);
  let failing = 0;
  for (const { abbrev } of teams) {
    const r = await verifyTeam(client, abbrev);
    if (r.issues.length === 0) {
      console.log(`PASS  ${abbrev}`);
      continue;
    }
    failing++;
    console.log(`FAIL  ${abbrev} — ${r.issues.length} issue(s)`);
    for (const issue of r.issues) console.log(`        - ${issue}`);
  }
  // Current, not just correct: see verify-freshness.ts.
  const stale = await checkFreshness(client);
  await client.end();
  console.log(`\n${teams.length - failing}/${teams.length} teams pass every invariant.`);
  if (stale.length === 0) {
    console.log("Freshness: every recently finished game is loaded (and every Bruins game narrated).");
  } else {
    console.log(`Freshness: ${stale.length} issue(s)`);
    for (const s of stale) console.log(`  - ${s}`);
  }
  if (failing > 0 || stale.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
