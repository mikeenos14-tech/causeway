-- The NHL API consistently uses single-letter position codes (C, L, R, D, G)
-- across both the roster and boxscore endpoints, not LW/RW as originally
-- assumed. Match the real source data rather than translating on the way in.

alter table players drop constraint players_position_check;
alter table players add constraint players_position_check
  check (position in ('C', 'L', 'R', 'D', 'G'));
