// Ties the backfill verification cadence into one command instead of two
// manual steps ("check, then separately remember to fix"): verify each
// given team, auto-run the bio-repair script if any of them need it, then
// re-verify to confirm it actually worked. See the sports-apps-vision
// skill's "Backfill verification cadence" section.
//
// Usage: npx tsx scripts/checkpoint.ts <ABBREV> [<ABBREV> ...]
// (pass the batch of teams that just finished in the rollout)

import { execSync } from "node:child_process";
import { Client } from "pg";
import { verifyTeam, type VerifyResult } from "./verify-team";

async function runChecks(client: Client, abbrevs: string[]): Promise<Map<string, VerifyResult>> {
  const results = new Map<string, VerifyResult>();
  for (const abbrev of abbrevs) {
    results.set(abbrev, await verifyTeam(client, abbrev));
  }
  return results;
}

function printResults(results: Map<string, VerifyResult>) {
  for (const [abbrev, r] of results) {
    if (!r.found) {
      console.log(`${abbrev}: no team found.`);
      continue;
    }
    const status = r.issues.length === 0 ? "PASS" : `${r.issues.length} issue(s)`;
    console.log(`${abbrev} (${r.team!.name}): ${status} — ${r.degradedCount} degraded name(s)`);
    for (const issue of r.issues) console.log(`    - ${issue}`);
  }
}

async function main() {
  const abbrevs = process.argv.slice(2);
  if (abbrevs.length === 0) throw new Error("Usage: npx tsx scripts/checkpoint.ts <ABBREV> [<ABBREV> ...]");

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log(`=== Checkpoint: ${abbrevs.join(", ")} ===\n`);
  const before = await runChecks(client, abbrevs);
  printResults(before);

  const needsRepair = [...before.values()].some((r) => r.degradedCount > 0);
  if (needsRepair) {
    console.log(`\nDegraded names found — running scripts/repair-player-bios.ts (repairs across all teams, not just this batch)...\n`);
    await client.end(); // repair script opens its own connection
    execSync("npx tsx scripts/repair-player-bios.ts", { stdio: "inherit" });

    const client2 = new Client({ connectionString: process.env.DATABASE_URL });
    await client2.connect();
    console.log(`\n=== Re-verifying after repair ===\n`);
    const after = await runChecks(client2, abbrevs);
    printResults(after);
    await client2.end();
  } else {
    console.log(`\nNo degraded names found — nothing to repair.`);
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
