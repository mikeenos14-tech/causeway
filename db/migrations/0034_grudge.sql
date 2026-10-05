-- Grudge Index (spec section 9): rivalry heat between franchises (nhl
-- franchise lineages), directional. Built from the history tables by
-- scripts/stats/build-grudge.ts; weights in config/stats.ts (GRUDGE).
create table if not exists grudge_events (
  event_id bigserial primary key,
  franchise_from integer not null,
  franchise_to integer not null,
  date date not null,
  type text not null,
  weight real not null,
  half_life_days real not null,
  reason_text text not null,
  game_id integer,
  model_version text not null
);
create index if not exists grudge_events_pair on grudge_events (franchise_from, franchise_to, date);

-- Heat on the last day of every month, and its 0-100 index: the percentile
-- of that heat among every rivalry-month in history (100 = as hot as any
-- rivalry has ever been).
create table if not exists grudge_monthly (
  franchise_from integer not null,
  franchise_to integer not null,
  month date not null,
  raw_heat real not null,
  index_0_100 real not null,
  primary key (franchise_from, franchise_to, month)
);

create table if not exists grudge_current (
  franchise_from integer not null,
  franchise_to integer not null,
  raw_heat real not null,
  index_0_100 real not null,
  top_reasons jsonb not null,
  peak_index real not null,
  peak_month date,
  model_version text not null,
  computed_at timestamptz not null default now(),
  primary key (franchise_from, franchise_to)
);
