-- Answer cache: guarantees the exact same question gets the exact same
-- answer, instead of a fresh (and possibly differently-shaped) model call
-- every time. Built 2026-09-18 after the user asked the same real question
-- twice in a row and got two different tables — the underlying architecture
-- calls the model fresh, from scratch, on every request, with no saved
-- "this is how we answer this" logic, so two runs of an identical question
-- can legitimately take different (each individually valid) paths through
-- the schema. A cache is the direct fix for that specific complaint; see
-- lib/qa-cache.ts for the TTL reasoning (kept short deliberately while the
-- full-league rollout is still actively changing the underlying data).
create table qa_answer_cache (
  normalized_question text primary key,
  question text not null,
  answer text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
