-- narratives previously allowed only one row per game, which was fine
-- when it only held the full game recap. The "what stood out" highlights
-- blurb is a second, distinct kind of narrative content for the same
-- game, generated separately — so this needs a composite key, not a
-- second table, since both are genuinely "a narrative about this game."
-- Table is still empty, so a clean recreate is safe (no data to migrate).
drop table narratives;

create table narratives (
  game_id integer not null references games(id),
  kind text not null check (kind in ('recap', 'highlights')),
  headline text,
  body text not null,
  facts_json jsonb,
  source text not null default 'ai_generated',
  model_version text,
  generated_at timestamptz not null default now(),
  primary key (game_id, kind)
);
