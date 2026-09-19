// One-time setup: a genuinely read-only Postgres role for the Q&A engine
// to connect as. This is defense at the database layer, not just app-level
// filtering — even if a generated query somehow tried to modify data, the
// database itself would refuse it, because the role has no write grant at
// all. Run once; the resulting connection string is written straight to
// .env.local, never printed to the terminal.

import { randomBytes } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { Client } from "pg";

const ROLE = "qa_readonly";

async function main() {
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) throw new Error("DATABASE_URL not set");

  const password = randomBytes(24).toString("base64url");
  const client = new Client({ connectionString: adminUrl });
  await client.connect();

  const { rows: existing } = await client.query("select 1 from pg_roles where rolname = $1", [ROLE]);
  if (existing.length > 0) {
    await client.query(`alter role ${ROLE} with password '${password}'`);
    console.log(`Role ${ROLE} already existed — password rotated.`);
  } else {
    await client.query(`create role ${ROLE} with login password '${password}'`);
    console.log(`Role ${ROLE} created.`);
  }

  const dbNameMatch = adminUrl.match(/\/([^/?]+)(\?|$)/);
  const dbName = dbNameMatch?.[1];
  if (!dbName) throw new Error("Could not parse database name from DATABASE_URL");

  await client.query(`grant connect on database ${dbName} to ${ROLE}`);
  await client.query(`grant usage on schema public to ${ROLE}`);
  await client.query(`grant select on all tables in schema public to ${ROLE}`);
  await client.query(`alter default privileges in schema public grant select on tables to ${ROLE}`);
  console.log("Read-only grants applied.");

  await client.end();

  // Build the read-only connection string from the admin one, swapping only
  // the credentials — never printed here, written straight to the file.
  const url = new URL(adminUrl);
  url.username = ROLE;
  url.password = password;
  const readonlyUrl = url.toString();

  const envPath = ".env.local";
  const existingEnv = readFileSync(envPath, "utf8");
  if (existingEnv.includes("DATABASE_URL_READONLY=")) {
    console.log("DATABASE_URL_READONLY already present in .env.local — not appending a duplicate. Update it manually if needed.");
  } else {
    // Quoted, matching the other entries Neon's own tooling wrote to this
    // file — an unquoted value breaks `source .env.local` in bash the
    // moment the connection string's query params contain "&", which every
    // real Neon connection string does. Found by that exact failure.
    appendFileSync(envPath, `\nDATABASE_URL_READONLY="${readonlyUrl}"\n`);
    console.log("Wrote DATABASE_URL_READONLY to .env.local.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
