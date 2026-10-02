-- Every club's current NHL roster, synced hourly by scripts/sync-rosters.ts,
-- so Roster pages never depend on the NHL answering at page-load time (a
-- rate-limited lookup once blanked a team's page). One row per player: a
-- player is on one roster at a time.
create table if not exists current_rosters (
  player_id integer primary key,
  team_abbrev text not null,
  full_name text not null,
  position text not null,
  sweater_number smallint,
  synced_at timestamptz not null default now()
);
create index if not exists current_rosters_team on current_rosters (team_abbrev);
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'qa_readonly') then
    revoke all on current_rosters from qa_readonly;
  end if;
end $$;
