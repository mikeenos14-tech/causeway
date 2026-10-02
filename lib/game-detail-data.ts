import { pool } from "./db";

export async function getGameDetail(gameId: number) {
  // Same highlights-then-recap fallback as the homepage's getLatestGame —
  // most games only ever get a 'recap' row (nothing statistically notable
  // enough for a real highlight), and this used to show only the bare
  // fallback headline for those, never a stored narrative at all.
  const { rows } = await pool.query(
    `select g.id, g.game_date, g.game_type, g.game_end_type, g.season_id,
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

export type TeamGameLine = {
  abbrev: string;
  shots: number | null;
  ppGoals: number | null;
  ppOpportunities: number | null;
  faceoffPct: number | null;
  hits: number | null;
  xg: number | null;
};

// Team totals for one game (NHL boxscore group + MoneyPuck xG), away team
// first. Either group can be missing for a given season — NULL, never 0 —
// and the page shows only what's loaded.
export async function getGameTeamLines(gameId: number): Promise<TeamGameLine[]> {
  const { rows } = await pool.query(
    `select t.abbrev, tgs.shots_on_goal, tgs.pp_goals, tgs.pp_opportunities, tgs.faceoff_win_pct, tgs.hits, tgs.xg_for,
            (g.home_team_id = t.id) as is_home
     from team_game_stats tgs
     join teams t on t.id = tgs.team_id
     join games g on g.id = tgs.game_id
     where tgs.game_id = $1
     order by is_home asc`,
    [gameId],
  );
  return rows.map((r) => ({
    abbrev: r.abbrev,
    shots: r.shots_on_goal,
    ppGoals: r.pp_goals,
    ppOpportunities: r.pp_opportunities,
    faceoffPct: r.faceoff_win_pct != null ? Number(r.faceoff_win_pct) : null,
    hits: r.hits,
    xg: r.xg_for != null ? Number(r.xg_for) : null,
  }));
}

export async function getTeamName(abbrev: string): Promise<string> {
  const { rows } = await pool.query(`select name from teams where abbrev = $1 order by is_active desc limit 1`, [abbrev]);
  return rows[0]?.name ?? abbrev;
}

export type AdjacentGame = { id: number; date: string | Date; label: string };

// The team's previous and next games around this one (regular season and
// playoffs, by date), for the arrows on a game page. Only games we have;
// the page fills in an upcoming preview when there's no next one yet.
export async function getAdjacentGames(gameId: number, teamAbbrev: string): Promise<{ prev: AdjacentGame | null; next: AdjacentGame | null }> {
  const { rows } = await pool.query(
    `with team_games as (
       select g.id, g.game_date,
              case when ht.abbrev = $2 then 'vs ' || at.abbrev else '@ ' || ht.abbrev end as label,
              lag(g.id) over w as prev_id, lead(g.id) over w as next_id
       from games g join teams ht on ht.id = g.home_team_id join teams at on at.id = g.away_team_id
       where (ht.abbrev = $2 or at.abbrev = $2) and g.game_type in ('regular', 'playoff')
       window w as (order by g.game_date, g.id))
     select t.id, t.game_date, t.label, (t.id = c.prev_id) as is_prev
     from team_games c join team_games t on t.id in (c.prev_id, c.next_id)
     where c.id = $1`,
    [gameId, teamAbbrev],
  );
  const pick = (prev: boolean) => {
    const r = rows.find((x) => x.is_prev === prev);
    return r ? { id: r.id, date: r.game_date, label: r.label } : null;
  };
  return { prev: pick(true), next: pick(false) };
}
