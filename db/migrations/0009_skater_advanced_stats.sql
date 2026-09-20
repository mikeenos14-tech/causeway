-- Player-level advanced stats from MoneyPuck, the individual-player
-- equivalent of team_game_stats' xg_for/xg_against/corsi_for/corsi_against
-- (added earlier for team-level data from the same source). Individual
-- xG/Corsi (this player's own shot attempts) answers "is he finishing
-- above or below what he should," on-ice % (the team's share of
-- attempts while he's on the ice) answers "is play moving the right way
-- when he's out there" — the two real angles on "who's actually driving
-- play," which raw goals/points can't show on their own.
alter table skater_game_stats
  add column ixg numeric(5, 2),
  add column icorsi smallint,
  add column on_ice_xg_pct numeric(5, 4),
  add column on_ice_corsi_pct numeric(5, 4);
