import { pool } from "./db";

export async function getLatestSeasonId(teamAbbrev: string) {
  const { rows } = await pool.query(
    `select g.season_id from games g
     join teams t on t.id = g.home_team_id or t.id = g.away_team_id
     where t.abbrev = $1
     order by g.game_date desc limit 1`,
    [teamAbbrev],
  );
  return rows[0]?.season_id ?? null;
}

export async function getSeasonSchedule(teamAbbrev: string, seasonId: string) {
  // has_highlight is true for a real significance-based highlight
  // specifically (not the general 'recap' fallback every other game
  // gets) — it marks "something notable happened," a stronger signal
  // than "there's some narration," which is what the recap kind means.
  const { rows } = await pool.query(
    `select g.id, g.game_date, g.game_type, g.game_end_type,
            case when ht.abbrev = $1 then true else false end as is_home,
            case when ht.abbrev = $1 then at.abbrev else ht.abbrev end as opponent,
            case when ht.abbrev = $1 then g.home_score else g.away_score end as team_score,
            case when ht.abbrev = $1 then g.away_score else g.home_score end as opp_score,
            (nh.game_id is not null) as has_highlight,
            (nr.game_id is not null) as has_recap
     from games g
     join teams ht on ht.id = g.home_team_id
     join teams at on at.id = g.away_team_id
     left join narratives nh on nh.game_id = g.id and nh.kind = 'highlights'
     left join narratives nr on nr.game_id = g.id and nr.kind = 'recap'
     where (ht.abbrev = $1 or at.abbrev = $1) and g.season_id = $2
     order by g.game_date asc`,
    [teamAbbrev, seasonId],
  );
  return rows;
}
