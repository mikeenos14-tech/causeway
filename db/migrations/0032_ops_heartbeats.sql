-- When each of the site's own background jobs last ran and how it went
-- (lib/load-game.ts recordHeartbeat). /api/health reads it: a job that
-- has stopped running is an alert, not something found by accident.
create table if not exists ops_heartbeats (
  name text primary key,
  at timestamptz not null,
  ok boolean not null,
  detail text
);
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'qa_readonly') then
    revoke all on ops_heartbeats from qa_readonly;
  end if;
end $$;
