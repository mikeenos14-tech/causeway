import { pool } from "./db";

export type PlayoffSeriesResult = {
  seasonId: string;
  round: number;
  opponentAbbrev: string;
  opponentName: string;
  won: boolean;
  teamWins: number;
  opponentWins: number;
  maxRoundThatSeason: number;
};

// Every playoff series this team has been part of, oldest first. Series
// wins/losses are counted from the actual games (not just games_played on
// playoff_series, which doesn't say who won which game) via the same
// series_id link the per-game "Playoff Series" box already uses.
// maxRoundThatSeason lets the UI label how far a team's playoff run in a
// given year actually went ("lost in the Final" vs. just "lost Round 4")
// without hardcoding which round number the Final happens to be.
export async function getPlayoffHistory(teamAbbrev: string): Promise<PlayoffSeriesResult[]> {
  const { rows } = await pool.query(
    `with team_series as (
       select ps.id, ps.season_id, ps.round, ps.winner_team_id,
              case when ta.abbrev = $1 then tb.abbrev else ta.abbrev end as opp_abbrev,
              case when ta.abbrev = $1 then tb.name else ta.name end as opp_name,
              case when ta.abbrev = $1 then ps.team_a_id else ps.team_b_id end as team_id
       from playoff_series ps
       join teams ta on ta.id = ps.team_a_id
       join teams tb on tb.id = ps.team_b_id
       where ta.abbrev = $1 or tb.abbrev = $1
     ),
     game_counts as (
       select g.series_id,
              sum(case when (g.home_team_id = ts.team_id and g.home_score > g.away_score)
                          or (g.away_team_id = ts.team_id and g.away_score > g.home_score)
                        then 1 else 0 end) as team_wins,
              sum(case when (g.home_team_id = ts.team_id and g.home_score < g.away_score)
                          or (g.away_team_id = ts.team_id and g.away_score < g.home_score)
                        then 1 else 0 end) as opp_wins
       from games g
       join team_series ts on ts.id = g.series_id
       group by g.series_id
     ),
     max_rounds as (
       select season_id, max(round) as max_round from playoff_series group by season_id
     )
     select ts.season_id, ts.round, ts.opp_abbrev, ts.opp_name,
            (ts.winner_team_id = ts.team_id) as won,
            coalesce(gc.team_wins, 0)::int as team_wins,
            coalesce(gc.opp_wins, 0)::int as opp_wins,
            mr.max_round as max_round_that_season
     from team_series ts
     left join game_counts gc on gc.series_id = ts.id
     join max_rounds mr on mr.season_id = ts.season_id
     order by ts.season_id asc, ts.round asc`,
    [teamAbbrev],
  );
  return rows.map((r) => ({
    seasonId: r.season_id,
    round: r.round,
    opponentAbbrev: r.opp_abbrev,
    opponentName: r.opp_name,
    won: r.won,
    teamWins: r.team_wins,
    opponentWins: r.opp_wins,
    maxRoundThatSeason: r.max_round_that_season,
  }));
}
