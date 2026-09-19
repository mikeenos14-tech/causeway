import { pool } from "./db";

// Simple team lookup, currently only for the team detail page header — get
// the display name and confirm the abbrev is real before running every
// other query for that page. Deliberately excludes the retired/renamed
// lineage duplicates (PHX, ARI, old-name UTA) via is_active, so a team
// page URL always resolves to the team's current identity.
export async function getTeam(teamAbbrev: string) {
  const { rows } = await pool.query(
    `select id, name, abbrev from teams where abbrev = $1 and is_active = true`,
    [teamAbbrev],
  );
  return rows[0] ?? null;
}

export type GameResult = {
  id: number;
  gameDate: string;
  gameType: string;
  homeAbbrev: string;
  awayAbbrev: string;
  homeScore: number;
  awayScore: number;
  gameEndType: string;
  isHome: boolean;
};

export async function getLatestGame(teamAbbrev: string) {
  // A game can have a 'highlights' row (something statistically notable),
  // a 'recap' row (the general-take fallback — most games), or neither yet
  // (not narrated at all). Prefer highlights when both exist.
  const { rows } = await pool.query(
    `select g.id, g.game_date, g.game_type, ht.abbrev as home_abbrev, at.abbrev as away_abbrev,
            g.home_score, g.away_score, g.game_end_type,
            coalesce(nh.headline, nr.headline) as headline,
            coalesce(nh.body, nr.body) as body
     from games g
     join teams ht on ht.id = g.home_team_id
     join teams at on at.id = g.away_team_id
     left join narratives nh on nh.game_id = g.id and nh.kind = 'highlights'
     left join narratives nr on nr.game_id = g.id and nr.kind = 'recap'
     where ht.abbrev = $1 or at.abbrev = $1
     order by g.game_date desc
     limit 1`,
    [teamAbbrev],
  );
  return rows[0] ?? null;
}

export async function getRecentForm(teamAbbrev: string, count = 5) {
  const { rows } = await pool.query(
    `select g.game_date,
            case when ht.abbrev = $1 then g.home_score else g.away_score end as team_score,
            case when ht.abbrev = $1 then g.away_score else g.home_score end as opp_score
     from games g
     join teams ht on ht.id = g.home_team_id
     join teams at on at.id = g.away_team_id
     where ht.abbrev = $1 or at.abbrev = $1
     order by g.game_date desc
     limit $2`,
    [teamAbbrev, count],
  );
  return rows.reverse().map((r) => (r.team_score > r.opp_score ? "W" : "L"));
}

export async function getLatestStandings(teamAbbrev: string) {
  const { rows } = await pool.query(
    `select ss.season_id, ss.division, ss.conference, ss.games_played, ss.wins, ss.losses, ss.ot_losses,
            ss.points, ss.points_pct, ss.division_rank, ss.conference_rank, ss.league_rank
     from standings_snapshots ss
     join teams t on t.id = ss.team_id
     where t.abbrev = $1
     order by ss.snapshot_date desc
     limit 1`,
    [teamAbbrev],
  );
  return rows[0] ?? null;
}

// Full division table for the standings snapshot section — getLatestStandings
// above only returns this team's own row, not its rivals for comparison.
export async function getDivisionStandings(teamAbbrev: string) {
  const own = await getLatestStandings(teamAbbrev);
  if (!own) return null;
  const { rows } = await pool.query(
    `select t.abbrev, t.name, ss.wins, ss.losses, ss.ot_losses, ss.points, ss.division_rank
     from standings_snapshots ss
     join teams t on t.id = ss.team_id
     where ss.season_id = $1 and ss.division = $2
     order by ss.division_rank asc`,
    [own.season_id, own.division],
  );
  return { division: own.division, teams: rows };
}

// Real scores/opponents for a row of "recent results" cards — getRecentForm
// above only returns W/L letters, which was enough for the old "last 5"
// dots but not for a card that needs to show an actual score.
export async function getRecentResults(teamAbbrev: string, count = 4) {
  const { rows } = await pool.query(
    `select g.id, g.game_date,
            case when ht.abbrev = $1 then g.home_score else g.away_score end as team_score,
            case when ht.abbrev = $1 then g.away_score else g.home_score end as opp_score,
            case when ht.abbrev = $1 then at.abbrev else ht.abbrev end as opp_abbrev,
            g.game_end_type
     from games g
     join teams ht on ht.id = g.home_team_id
     join teams at on at.id = g.away_team_id
     where ht.abbrev = $1 or at.abbrev = $1
     order by g.game_date desc
     limit $2`,
    [teamAbbrev, count],
  );
  return rows;
}

// Season stat leaders for the homepage's "Stat Leaders" cards — scoped to
// this team's most recently loaded season (not all-time), same "current
// year" scope the rest of the non-Ask site is meant to hold to now. Always
// the real current season, whatever its sample size — a low-game-count
// leader (e.g. "2 goals in 3 games") is genuinely accurate information,
// not something to hide or blend; every real hockey site shows exactly
// this in October without hedging it. The one real exception is the
// goalie minimum-games qualifier below, which is standard practice (the
// NHL's own save% leaderboard does the same) for a different reason: it's
// filtering out a tiny, noisy sample from a specific stat, not switching
// the season being shown.
export async function getStatLeaders(teamAbbrev: string) {
  const { rows: seasonRows } = await pool.query(
    `select max(g.season_id) as season_id
     from games g join teams t on t.id = g.home_team_id or t.id = g.away_team_id
     where t.abbrev = $1 and g.game_type = 'regular'`,
    [teamAbbrev],
  );
  const seasonId = seasonRows[0]?.season_id;
  if (!seasonId) return null;

  const { rows: pointsRows } = await pool.query(
    `select p.id, p.full_name, sum(sgs.goals) as goals, sum(sgs.assists) as assists, sum(sgs.points) as points
     from skater_game_stats sgs
     join games g on g.id = sgs.game_id
     join players p on p.id = sgs.player_id
     join teams t on t.id = sgs.team_id
     where t.abbrev = $1 and g.season_id = $2 and g.game_type = 'regular'
     group by p.id, p.full_name
     order by points desc
     limit 1`,
    [teamAbbrev, seasonId],
  );
  const { rows: goalsRows } = await pool.query(
    `select p.id, p.full_name, sum(sgs.goals) as goals
     from skater_game_stats sgs
     join games g on g.id = sgs.game_id
     join players p on p.id = sgs.player_id
     join teams t on t.id = sgs.team_id
     where t.abbrev = $1 and g.season_id = $2 and g.game_type = 'regular'
     group by p.id, p.full_name
     order by goals desc
     limit 1`,
    [teamAbbrev, seasonId],
  );
  const { rows: assistsRows } = await pool.query(
    `select p.id, p.full_name, sum(sgs.assists) as assists
     from skater_game_stats sgs
     join games g on g.id = sgs.game_id
     join players p on p.id = sgs.player_id
     join teams t on t.id = sgs.team_id
     where t.abbrev = $1 and g.season_id = $2 and g.game_type = 'regular'
     group by p.id, p.full_name
     order by assists desc
     limit 1`,
    [teamAbbrev, seasonId],
  );
  const { rows: plusMinusRows } = await pool.query(
    `select p.id, p.full_name, sum(sgs.plus_minus) as plus_minus
     from skater_game_stats sgs
     join games g on g.id = sgs.game_id
     join players p on p.id = sgs.player_id
     join teams t on t.id = sgs.team_id
     where t.abbrev = $1 and g.season_id = $2 and g.game_type = 'regular'
     group by p.id, p.full_name
     order by plus_minus desc
     limit 1`,
    [teamAbbrev, seasonId],
  );
  const { rows: hitsRows } = await pool.query(
    `select p.id, p.full_name, sum(sgs.hits) as hits
     from skater_game_stats sgs
     join games g on g.id = sgs.game_id
     join players p on p.id = sgs.player_id
     join teams t on t.id = sgs.team_id
     where t.abbrev = $1 and g.season_id = $2 and g.game_type = 'regular'
     group by p.id, p.full_name
     order by hits desc
     limit 1`,
    [teamAbbrev, seasonId],
  );
  const { rows: blocksRows } = await pool.query(
    `select p.id, p.full_name, sum(sgs.blocked_shots) as blocks
     from skater_game_stats sgs
     join games g on g.id = sgs.game_id
     join players p on p.id = sgs.player_id
     join teams t on t.id = sgs.team_id
     where t.abbrev = $1 and g.season_id = $2 and g.game_type = 'regular'
     group by p.id, p.full_name
     order by blocks desc
     limit 1`,
    [teamAbbrev, seasonId],
  );
  // Minimum 10 games played to keep a one-start backup goalie's small-sample
  // save% from dominating — not the same "minimum 50" convention used for
  // an all-time single-season record (a much bigger, completed-season
  // population); this is a current, possibly still-in-progress season.
  const { rows: goalieRows } = await pool.query(
    `select p.id, p.full_name, count(*) as games, sum(ggs.saves) as saves, sum(ggs.shots_against) as shots_against
     from goalie_game_stats ggs
     join games g on g.id = ggs.game_id
     join players p on p.id = ggs.player_id
     join teams t on t.id = ggs.team_id
     where t.abbrev = $1 and g.season_id = $2 and g.game_type = 'regular'
     group by p.id, p.full_name
     having count(*) >= 10
     order by (sum(ggs.saves)::numeric / nullif(sum(ggs.shots_against), 0)) desc
     limit 1`,
    [teamAbbrev, seasonId],
  );

  return {
    seasonId,
    points: pointsRows[0] ?? null,
    goals: goalsRows[0] ?? null,
    assists: assistsRows[0] ?? null,
    plusMinus: plusMinusRows[0] ?? null,
    hits: hitsRows[0] ?? null,
    blocks: blocksRows[0] ?? null,
    goalie: goalieRows[0] ? { ...goalieRows[0], savePct: Number(goalieRows[0].saves) / Number(goalieRows[0].shots_against) } : null,
  };
}
