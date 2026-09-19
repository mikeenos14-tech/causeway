import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

async function main() {
  const dir = join(import.meta.dirname, "..", "db", "migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query(
      `create table if not exists schema_migrations (
         version text primary key,
         applied_at timestamptz not null default now()
       )`,
    );

    const { rows } = await client.query<{ version: string }>(
      "select version from schema_migrations",
    );
    const applied = new Set(rows.map((r) => r.version));

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip  ${file} (already applied)`);
        continue;
      }
      console.log(`apply ${file}`);
      const sql = readFileSync(join(dir, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (version) values ($1)", [file]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    }
  } finally {
    await client.end();
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
