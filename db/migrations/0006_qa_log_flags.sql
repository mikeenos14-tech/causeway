-- Fast-detection net for the Q&A engine (see sports-apps-vision skill's
-- "Pre-public-launch gate"): a way for a user to flag a bad answer right
-- in the UI, so anything that slips past testing is caught from real
-- usage within hours, not discovered publicly.
alter table qa_log add column flagged boolean not null default false;
alter table qa_log add column flag_note text;
alter table qa_log add column flagged_at timestamptz;

create index qa_log_flagged_idx on qa_log (flagged) where flagged;
