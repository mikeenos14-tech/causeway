import { pool } from "./db";
import { QAStepLimitError, type QAResult, type QueryRecord } from "./qa-engine";

// Logs every real question asked through /api/ask — the actual best source
// of future bugs, since real fans ask things neither of us thought to test
// (see db/migrations/0005_qa_log.sql). Never let a logging failure break
// the user's actual response; this is purely for later review. Returns the
// row id (for the UI's "flag this answer" control) or null if logging
// itself failed — the answer still returns to the user either way.
function serializeQueries(queries: QueryRecord[]) {
  return JSON.stringify(queries.map((q) => ({ sql: q.sql, row_count: q.rows?.length ?? null, error: q.error ?? null })));
}

export async function logQuestion(question: string, result: QAResult): Promise<number | null> {
  try {
    const { rows } = await pool.query(
      `insert into qa_log (question, answer, queries, had_table, table_row_count)
       values ($1, $2, $3, $4, $5)
       returning id`,
      [
        question,
        result.answer,
        serializeQueries(result.queries),
        result.table !== null,
        result.table?.rows.length ?? null,
      ],
    );
    return rows[0].id as number;
  } catch (err) {
    console.error("qa_log insert failed (non-fatal):", err);
    return null;
  }
}

// The fast-detection net itself (see sports-apps-vision skill's
// "Pre-public-launch gate") — a user-flagged answer surfaces here within
// hours instead of being discovered publicly. Not fatal to the caller if
// it fails; the UI just shows a generic error and the user can try again.
export async function flagQuestion(logId: number, note: string | null): Promise<void> {
  await pool.query(
    `update qa_log set flagged = true, flag_note = $2, flagged_at = now() where id = $1`,
    [logId, note],
  );
}

export async function logQuestionError(question: string, error: unknown): Promise<void> {
  // A QAStepLimitError carries the queries it actually attempted before
  // hitting the ceiling — without this, every step-limit failure logged an
  // empty queries array, losing exactly what's needed to diagnose why.
  const queries = error instanceof QAStepLimitError ? error.queries : [];
  try {
    await pool.query(
      `insert into qa_log (question, answer, queries, had_table, table_row_count, error)
       values ($1, '', $2, false, null, $3)`,
      [question, serializeQueries(queries), error instanceof Error ? error.message : String(error)],
    );
  } catch (err) {
    console.error("qa_log insert failed (non-fatal):", err);
  }
}
