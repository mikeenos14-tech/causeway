-- Since 1999-2000, a team that pulls its goalie in overtime and loses on
-- the resulting empty-net goal gets no point: a regulation-style loss in
-- the standings, not an OTL. Found reconciling against the NHL's official
-- standings (the only 3 differences in 1,791 team-seasons: VAN 1999-00,
-- LAK 2002-03, MIN 2023-24). Every W-L-OTL on the site counts these as L.
-- Set from nhl_goal_events (hourly, after new games load).
alter table games add column if not exists ot_loser_point boolean not null default true;
update games g set ot_loser_point = false
where g.game_type = 'regular' and g.game_end_type = 'overtime'
  and exists (select 1 from nhl_goal_events e where e.game_id = g.id and e.period_type = 'OT' and e.empty_net);
