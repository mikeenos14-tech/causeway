-- Official NHL headshots for players on a current NHL roster, refreshed
-- daily by scripts/sync-headshots.ts from every club's current roster.
-- Keyed by NHL player id with no foreign key on purpose: a rookie can be
-- on a roster (and in the roster-changes card) before he has a game, so
-- before he has a players row. (0012-0017 are the stats-layer migrations
-- on feat/phase0-data-layer.)
create table if not exists player_headshots (
  player_id integer primary key,
  url text not null check (url like 'https://assets.nhle.com/mugs/%'),
  team_abbrev text not null,
  season_id text not null,
  synced_at timestamptz not null default now()
);
