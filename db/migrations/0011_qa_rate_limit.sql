-- One row per /api/ask attempt, checked before any model call so a loop
-- (or a link posted somewhere public) can't run up the Anthropic bill.
-- client_hash is a salted SHA-256 of the caller's IP, never the IP itself.
create table if not exists qa_requests (
  id bigserial primary key,
  client_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists qa_requests_client_idx on qa_requests (client_hash, created_at desc);
create index if not exists qa_requests_created_idx on qa_requests (created_at desc);
