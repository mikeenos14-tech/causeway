// A player first seen in a box score before his team's season roster lists
// him is saved with the box score's short name ("A. Smits") and no bio
// (scripts/backfill-season.ts, fallback branch). Normally a later run with
// his bio heals it, but nothing guarantees that run; this does, hourly:
// every player whose name is still an initial gets his NHL player page
// fetched and his real name and bio filled in. Usually zero or a handful.
//
// Usage: npx tsx --env-file=.env.local scripts/repair-abbreviated-names.ts

import { Client } from "pg";

/* eslint-disable @typescript-eslint/no-explicit-any -- the NHL feed is untyped JSON */
async function get(url: string): Promise<any> {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "causeway/1.0" } });
      if (res.ok) return res.json();
      if (res.status === 404) return null;
    } catch {
      // network error: retry
    }
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  throw new Error(`failed: ${url}`);
}

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const { rows } = await db.query(`select id, full_name from players where full_name ~ '^[A-Z]\\. ' order by id`);
  let fixed = 0;
  for (const r of rows) {
    const p = await get(`https://api-web.nhle.com/v1/player/${r.id}/landing`);
    const first = p?.firstName?.default, last = p?.lastName?.default;
    // Only a real first name that matches the initial we already have.
    if (!first || !last || first.length < 2 || first[0].toUpperCase() !== r.full_name[0]) {
      console.log(`  skip ${r.id} ${r.full_name}: NHL has ${first ?? "?"} ${last ?? "?"}`);
      continue;
    }
    await db.query(
      `update players set full_name = $2,
              shoots_catches = coalesce(shoots_catches, $3), birth_date = coalesce(birth_date, $4), birth_country = coalesce(birth_country, $5),
              height_cm = coalesce(height_cm, $6), weight_kg = coalesce(weight_kg, $7), updated_at = now()
       where id = $1`,
      [r.id, `${first} ${last}`, p.shootsCatches ?? null, p.birthDate ?? null, p.birthCountry ?? null, p.heightInCentimeters ?? null, p.weightInKilograms ?? null],
    );
    console.log(`  ${r.full_name} → ${first} ${last}`);
    fixed++;
    await new Promise((res) => setTimeout(res, 150));
  }
  await db.end();
  console.log(`${rows.length} abbreviated names found, ${fixed} fixed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
