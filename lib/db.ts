import { Pool } from "pg";

// A Pool, not a single Client — Next.js serves concurrent requests, and a
// single long-lived Client (fine in our one-shot backfill scripts) can't
// safely handle overlapping queries, the same issue already hit and fixed
// in the significance-checks library.
declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined;
}

export const pool =
  global._pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
  });

if (process.env.NODE_ENV !== "production") global._pgPool = pool;

declare global {
  // eslint-disable-next-line no-var
  var _pgReadonlyPool: Pool | undefined;
}

// A separate pool, connected as the qa_readonly role (see
// scripts/setup-readonly-role.ts) — genuinely cannot write, enforced by
// Postgres itself, not just application code. Only the Q&A engine should
// ever use this; every other part of the app uses the normal `pool` above.
export const readonlyPool =
  global._pgReadonlyPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL_READONLY,
    max: 3,
  });

if (process.env.NODE_ENV !== "production") global._pgReadonlyPool = readonlyPool;
