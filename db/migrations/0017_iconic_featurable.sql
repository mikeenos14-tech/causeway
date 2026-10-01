-- Some historically significant games matter because someone was badly
-- hurt (Ace Bailey 1933, Neely 1991, Savard 2010). They're kept as history
-- but never become a Doppelganger "featured" twin. Also records where each
-- curated entry came from.
alter table iconic_games add column featurable boolean not null default true;
alter table iconic_games add column sources text[];
