-- Each game's chances (lib/xg.ts): expected goals per team with a goalie
-- in net, by period, unblocked shot attempts, and how often the home team
-- wins on those chances ("deserved to win"). 2009-10 on (the first season
-- with shot locations). Built by scripts/stats/build-game-chances.ts and on
-- each game's final (lib/load-game.ts).
create table if not exists game_chances (
  game_id integer primary key,
  home_xg real not null,
  away_xg real not null,
  by_period jsonb not null,
  home_shots smallint not null,
  away_shots smallint not null,
  deserved_home real not null,
  model_version text not null,
  updated_at timestamptz not null default now()
);
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'qa_readonly') then
    revoke all on game_chances from qa_readonly;
  end if;
end $$;
