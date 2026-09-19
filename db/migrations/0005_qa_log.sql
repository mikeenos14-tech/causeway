-- Logs every real question asked through the Q&A engine in production.
-- This is the actual best source of future bugs: real fans ask things
-- neither of us thought to test (the "Anderson" name-ambiguity bug and the
-- missing today's-date context were both found this way, by us guessing at
-- questions — a log of real usage finds this for free, going forward).
--
-- Stores which SQL ran and how many rows/errors each returned, not the
-- actual row payloads — that data is already reproducible by re-running
-- the SQL against the live tables, and logging it again here would just
-- duplicate storage for no benefit.
create table qa_log (
  id serial primary key,
  question text not null,
  answer text not null,
  queries jsonb not null,  -- [{sql, row_count, error}], never raw row data
  had_table boolean not null,
  table_row_count integer,
  error text,              -- set when answerQuestion() itself threw
  created_at timestamptz not null default now()
);

create index qa_log_created_at_idx on qa_log (created_at desc);
