import { Client } from "pg";
import { runSignificanceChecks } from "../lib/significance-checks";

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const testGameIds = process.argv.slice(2).map(Number);
  for (const gameId of testGameIds) {
    console.log(`\n=== game ${gameId} ===`);
    const facts = await runSignificanceChecks(client, gameId);
    if (facts.length === 0) {
      console.log("(nothing notable found)");
    } else {
      for (const f of facts) {
        console.log(`[${f.category}] (${f.population}) ${f.fact}`);
      }
    }
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
