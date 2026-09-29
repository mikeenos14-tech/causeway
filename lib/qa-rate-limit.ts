import { createHash } from "node:crypto";
import { pool } from "./db";

// Every question costs real model calls, so /api/ask checks two budgets
// before answering: one per person (by hashed IP) and one for the whole
// site, as a backstop if the link ends up somewhere public. Generous for
// a group of friends; a runaway loop hits the wall within minutes.
export const PER_CLIENT_PER_HOUR = 30;
export const SITE_PER_DAY = 300;

export function clientHash(ip: string): string {
  return createHash("sha256").update(`${process.env.QA_RATE_SALT ?? "causeway-qa"}:${ip}`).digest("hex").slice(0, 32);
}

export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}

// Records the attempt and returns null if it's allowed, or the message to
// show if a budget is spent. Fails open on a database error: the question
// itself needs the database, so it would fail anyway, and a limiter bug
// shouldn't take the Ask box down.
export async function checkAndRecord(hash: string): Promise<string | null> {
  try {
    const { rows } = await pool.query(
      `select count(*) filter (where client_hash = $1 and created_at > now() - interval '1 hour')::int as mine,
              count(*) filter (where created_at > now() - interval '1 day')::int as site
       from qa_requests where created_at > now() - interval '1 day'`,
      [hash],
    );
    if (rows[0].mine >= PER_CLIENT_PER_HOUR) {
      return `That's ${PER_CLIENT_PER_HOUR} questions in the last hour — give it a bit and ask again.`;
    }
    if (rows[0].site >= SITE_PER_DAY) {
      return "The Ask box has hit its daily limit. It resets over the next day.";
    }
    await pool.query(`insert into qa_requests (client_hash) values ($1)`, [hash]);
    return null;
  } catch (err) {
    console.error("qa rate limit check failed (allowing):", err);
    return null;
  }
}
