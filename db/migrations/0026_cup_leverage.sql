-- Cup Leverage (spec section 8, V2): how much winning each playoff game's
-- series would move each team's chance of winning the Stanley Cup, from
-- the teams that actually played the later rounds. Null before 1926-27
-- (the NHL champion then played another league for the Cup) and where the
-- bracket can't be followed. Per game, both sides; per player, the sum.
alter table leverage_games add column if not exists cup_home real;
alter table leverage_games add column if not exists cup_away real;
alter table player_leverage add column if not exists cup_lg real;
