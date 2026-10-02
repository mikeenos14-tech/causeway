-- Win probability model (spec section 5), built by scripts/stats/build-wp.ts:
-- fitted parameters plus held-out test results per version, and the
-- empirical correction table (era x regular/playoff x minute x margin).
create table if not exists wp_model (
  model_version text primary key,
  params jsonb not null,
  metrics jsonb not null,
  built_at timestamptz not null default now()
);
create table if not exists wp_cells (
  model_version text not null references wp_model(model_version) on delete cascade,
  cell text not null,
  n integer not null,
  win double precision not null,
  loss double precision not null,
  model_win double precision not null,
  model_loss double precision not null,
  primary key (model_version, cell)
);
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'qa_readonly') then
    revoke all on wp_model, wp_cells from qa_readonly;
  end if;
end $$;
