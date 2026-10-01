import { pool } from "./db";
import { answerQuestion, type QAResult } from "./qa-engine";

// Cache-only layer: answerQuestion() itself stays uncached and is called
// directly by scripts/qa-regression-suite.ts, which needs a real, fresh
// model call every run to actually test current behavior — caching there
// would defeat the point of a regression suite. This wrapper is for the
// live /api/ask route only.

// Deliberately short while the full-league rollout is still running: a
// cached answer about a team whose data just changed (new season loaded,
// a repair script ran) would otherwise serve a stale answer for however
// long the TTL is. Once the rollout is complete and the data stops
// changing day to day, this can safely grow much longer (weeks), which
// is also when it starts meaningfully saving on API cost.
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Deliberately simple (exact-match after normalization), not semantic/
// fuzzy matching — that's a real NLP problem of its own and not needed to
// fix the specific complaint this exists for (asking the identical
// question twice). Lowercase, collapse whitespace, strip trailing
// punctuation, so "What was Boldy's stat line?" and "what was boldy's stat
// line??" hit the same cache entry.
export function normalizeQuestion(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, " ").replace(/[?!.]+$/, "");
}

// options.maxAgeMs / freshAfter: the question of the day is answered once
// daily, so it's served for up to 36 hours — but never from before the
// latest Bruins game was loaded (lib/question-of-the-day.ts).
export async function answerQuestionCached(
  question: string,
  options: { maxAgeMs?: number; freshAfter?: Date | null } = {},
): Promise<QAResult & { fromCache: boolean }> {
  const normalized = normalizeQuestion(question);
  const maxAgeMs = options.maxAgeMs ?? CACHE_TTL_MS;

  try {
    const { rows } = await pool.query(
      `select result, created_at from qa_answer_cache where normalized_question = $1`,
      [normalized],
    );
    if (rows.length > 0) {
      const created = new Date(rows[0].created_at);
      const ageMs = Date.now() - created.getTime();
      if (ageMs < maxAgeMs && (!options.freshAfter || created > options.freshAfter)) {
        return { ...(rows[0].result as QAResult), fromCache: true };
      }
    }
  } catch (err) {
    console.error("qa_answer_cache read failed (non-fatal, falling through to a fresh answer):", err);
  }

  const result = await answerQuestion(question);

  try {
    await pool.query(
      `insert into qa_answer_cache (normalized_question, question, answer, result)
       values ($1, $2, $3, $4)
       on conflict (normalized_question) do update set
         question = excluded.question, answer = excluded.answer, result = excluded.result, created_at = now()`,
      [normalized, question, result.answer, JSON.stringify(result)],
    );
  } catch (err) {
    console.error("qa_answer_cache write failed (non-fatal):", err);
  }

  return { ...result, fromCache: false };
}
