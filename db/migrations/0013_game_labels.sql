-- Names for notable games, so the Doppelganger card can always say which
-- game a twin was ("2013 Round 1, Game 7: BOS 5-4 TOR in OT") even when it
-- isn't on the curated iconic_games list. Every label is generated from the
-- loaded history by scripts/stats/build-game-labels.ts and rebuilt from
-- scratch each run, so it can't drift from the data.
create table game_labels (
  game_id integer not null references nhl_games(id) on delete cascade,
  kind text not null,          -- cup_clincher, game7, series_clincher_ot, long_ot, playoff_ot, comeback, blown_lead, milestone_goal, fifty_goal, penalty_night
  label text not null,
  fame_points numeric not null, -- structural fame, added to any curated fame_weight
  primary key (game_id, kind, label)
);
create index game_labels_kind_idx on game_labels (kind);

revoke all on game_labels from qa_readonly;
