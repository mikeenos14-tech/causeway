-- Without this, re-running a backfill for a season with playoff games
-- would insert duplicate series rows instead of upserting — the same
-- idempotency guarantee every other table in this schema already has.
alter table playoff_series
  add constraint playoff_series_season_round_matchup_key
  unique (season_id, round, team_a_id, team_b_id);
