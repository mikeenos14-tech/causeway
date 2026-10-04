// Records that a background job ran (ops_heartbeats; /api/health alerts
// when one stops). Usage: npx tsx scripts/ops-heartbeat.ts <name> <ok|failed> [detail]
import { Client } from "pg";

(async () => {
  const [name, status, ...detail] = process.argv.slice(2);
  if (!name || !["ok", "failed"].includes(status)) throw new Error("usage: ops-heartbeat.ts <name> <ok|failed> [detail]");
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query(
    `insert into ops_heartbeats (name, at, ok, detail) values ($1, now(), $2, $3)
     on conflict (name) do update set at = excluded.at, ok = excluded.ok, detail = excluded.detail`,
    [name, status === "ok", detail.join(" ") || null],
  );
  await db.end();
})();
