-- Apply after the Ask code that queries the qa views is live (0027).
-- Locks qa_readonly to them: qa first on its search_path, and no direct
-- access to the 2007-on base tables, so there's one source per name.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'qa_readonly') then
    revoke select on public.games, public.teams, public.players, public.skater_game_stats, public.goalie_game_stats,
                     public.seasons, public.playoff_series, public.standings_snapshots from qa_readonly;
    alter role qa_readonly set search_path = qa, public;
  end if;
end $$;
