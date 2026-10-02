-- Ask Causeway's read-only role has no use for photo URLs; keep them out of
-- its reach, like the nhl_* history tables (default privileges granted it).
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'qa_readonly') then
    revoke all on player_headshots from qa_readonly;
  end if;
end $$;
