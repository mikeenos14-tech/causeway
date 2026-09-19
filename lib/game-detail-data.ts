import { pool } from "./db";

export async function getGameDetail(gameId: number) {
  // Same highlights-then-recap fallback as the homepage's getLatestGame —
  // most games only ever get a 'recap' row (nothing statistically notable
  // enough for a real highlight), and this used to show only the bare
  // fallback headline for those, never a stored narrative at all.
  const { rows } = await pool.query(
    `select g.id, g.game_date, g.game_type, g.game_end_type,
            ht.abbrev as home_abbrev, at.abbrev as away_abbrev,
            g.home_score, g.away_score, g.venue,
            coalesce(nh.headline, nr.headline) as headline,
            coalesce(nh.body, nr.body) as body
     from games g
     join teams ht on ht.id = g.home_team_id
     join teams at on at.id = g.away_team_id
     left join narratives nh on nh.game_id = g.id and nh.kind = 'highlights'
     left join narratives nr on nr.game_id = g.id and nr.kind = 'recap'
     where g.id = $1`,
    [gameId],
  );
  return rows[0] ?? null;
}

export async function getGameSkaters(gameId: number) {
  const { rows } = await pool.query(
    `select s.player_id, p.full_name, t.abbrev as team_abbrev, s.goals, s.assists, s.points,
            s.shots, s.hits, s.blocked_shots, s.plus_minus, s.penalty_minutes, s.toi_seconds
     from skater_game_stats s
     join players p on p.id = s.player_id
     join teams t on t.id = s.team_id
     where s.game_id = $1
     order by s.points desc, s.goals desc`,
    [gameId],
  );
  return rows;
}

export async function getGameGoalies(gameId: number) {
  const { rows } = await pool.query(
    `select s.player_id, p.full_name, t.abbrev as team_abbrev, s.decision, s.shots_against,
            s.saves, s.goals_against, s.save_pct, s.toi_seconds, s.shutout
     from goalie_game_stats s
     join players p on p.id = s.player_id
     join teams t on t.id = s.team_id
     where s.game_id = $1
     order by s.toi_seconds desc nulls last`,
    [gameId],
  );
  return rows;
}
