// Read side of the 1917-on history (the nhl_* tables, loaded and audited
// by scripts/stats/*): Bruins seasons for the season pickers, a season's
// schedule before 2007-08, and one historical game for its page. The
// site's own tables (games, box scores, recaps) still serve 2007-08 on;
// this only fills in what they don't have.

import { pool } from "./db";

export const BOS_TEAM_ID = 6;
export const BOX_SCORES_FROM = "20072008"; // the site's own box-score tables start here

// Every season the Bruins played, newest first.
export async function getBruinsSeasons(): Promise<string[]> {
  const { rows } = await pool.query(
    `select distinct season from nhl_games where home_team_id = $1 or away_team_id = $1 order by season desc`,
    [BOS_TEAM_ID],
  );
  return rows.map((r) => r.season as string);
}

export type HistoryRow = {
  id: number;
  date: string;
  gameType: "regular" | "playoff";
  isHome: boolean;
  opponent: string;
  team: number;
  opp: number;
  finalState: "REG" | "OT" | "SO" | "TIE";
  notable: string | null; // iconic label, or a computed label (Game 7, comeback...)
};

export async function getHistorySeasonSchedule(seasonId: string): Promise<HistoryRow[]> {
  const { rows } = await pool.query(
    `select g.id, g.game_date::text as date, g.game_type, g.home_team_id = $2 as is_home,
            case when g.home_team_id = $2 then at.tri_code else ht.tri_code end as opponent,
            case when g.home_team_id = $2 then g.home_score else g.away_score end as team,
            case when g.home_team_id = $2 then g.away_score else g.home_score end as opp,
            g.final_state,
            coalesce(ig.label, (select l.label from game_labels l where l.game_id = g.id order by l.fame_points desc limit 1)) as notable
     from nhl_games g
     join nhl_teams ht on ht.id = g.home_team_id join nhl_teams at on at.id = g.away_team_id
     left join iconic_games ig on ig.game_id = g.id and ig.featurable
     where g.season = $1 and (g.home_team_id = $2 or g.away_team_id = $2)
     order by g.game_date, g.id`,
    [seasonId, BOS_TEAM_ID],
  );
  return rows.map((r) => ({ id: r.id, date: r.date, gameType: r.game_type, isHome: r.is_home, opponent: r.opponent, team: r.team, opp: r.opp, finalState: r.final_state, notable: r.notable }));
}

// A team's record written the way that era's standings wrote it: ties
// until 2004-05, overtime losses as their own column from 1999-2000, and
// before that an OT loss was simply a loss.
export function eraRecord(seasonId: string, games: { team: number; opp: number; finalState: string }[]): string {
  const w = games.filter((g) => g.team > g.opp).length;
  const t = games.filter((g) => g.team === g.opp).length;
  const otl = seasonId >= "19992000" ? games.filter((g) => g.team < g.opp && g.finalState !== "REG").length : 0;
  const l = games.filter((g) => g.team < g.opp).length - otl;
  if (seasonId >= "20052006") return `${w}-${l}-${otl}`;
  if (seasonId >= "19992000") return `${w}-${l}-${t}-${otl}`;
  return `${w}-${l}-${t}`;
}

// The result tag for one game in that era: OTL only once the column
// existed (1999-2000), never in the playoffs.
export function eraResult(seasonId: string, gameType: string, team: number, opp: number, finalState: string): "W" | "L" | "T" | "OTL" {
  if (team > opp) return "W";
  if (team === opp) return "T";
  return finalState !== "REG" && gameType === "regular" && seasonId >= "19992000" ? "OTL" : "L";
}

// Round names by era, counted back from the Final: the NHL's labels have
// changed (preliminary round, quarterfinals, conference finals) and a
// plain "Round 1" would call the 1933 semifinal a first round.
export function roundName(seasonId: string, round: number, maxRound: number, series = 1): string {
  if (round === 0) return "Qualifying round";
  // 1928-29 to 1941-42 the feed files three rounds under round 1: series 1
  // is the top seeds' semifinal, series 2 and 3 the quarterfinals, series 4
  // the quarterfinal winners' semifinal. Round 2 is the Final.
  if (seasonId >= "19281929" && seasonId <= "19411942" && round === 1) return series === 2 || series === 3 ? "Quarterfinal" : "Semifinal";
  const fromFinal = maxRound - round;
  const modern = seasonId >= "19811982";
  if (fromFinal === 0) return seasonId >= "19261927" ? "Stanley Cup Final" : "NHL Final";
  if (fromFinal === 1) return modern ? "Conference Final" : "Semifinal";
  if (fromFinal === 2) return modern ? "Second Round" : "Quarterfinal";
  return modern ? "First Round" : "Preliminary round";
}

// Playoff ids: SSSS 03 0 R S G (round, series, game).
export const playoffParts = (id: number) => ({ round: Math.floor(id / 100) % 10, series: Math.floor(id / 10) % 10, game: id % 10 });

export type HistoryGame = {
  id: number;
  season: string;
  gameType: "regular" | "playoff";
  date: string;
  venue: string | null;
  city: string | null;
  home: { id: number; code: string; name: string; score: number; sog: number | null };
  away: { id: number; code: string; name: string; score: number; sog: number | null };
  finalState: "REG" | "OT" | "SO" | "TIE";
  otPeriods: number;
  tier: string | null;
  hasStrength: boolean;
  stage: string | null; // "1970 Stanley Cup Final, Game 4"
  goals: { period: number; periodType: string; time: string; team: string; scorer: string | null; scorerId: number | null; assists: string[]; strength: string | null; emptyNet: boolean | null; homeAfter: number; awayAfter: number }[];
  penalties: { period: number; time: string; team: string | null; player: string | null; minutes: number | null; infraction: string | null }[];
  periods: { period: number; periodType: string; home: number; away: number; homeShots: number | null; awayShots: number | null }[];
  iconic: { label: string; story: string; featurable: boolean } | null;
  labels: string[];
};

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

export async function getHistoryGame(gameId: number): Promise<HistoryGame | null> {
  const { rows: [g] } = await pool.query(
    `select g.*, g.game_date::text as date,
            ht.tri_code as home_code, ht.full_name as home_name, at.tri_code as away_code, at.full_name as away_name
     from nhl_games g join nhl_teams ht on ht.id = g.home_team_id join nhl_teams at on at.id = g.away_team_id
     where g.id = $1`,
    [gameId],
  );
  if (!g) return null;
  const name = `coalesce(p.full_name, null)`;
  const [{ rows: goals }, { rows: pens }, { rows: periods }, { rows: iconic }, { rows: labels }, { rows: maxRound }] = await Promise.all([
    pool.query(
      `select e.period, e.period_type, e.time_in_period_sec, t.tri_code as team, ${name} as scorer, e.scorer_id,
              a1.full_name as a1, a2.full_name as a2, e.strength, e.empty_net, e.score_before_home, e.score_before_away, e.team_id
       from nhl_goal_events e join nhl_teams t on t.id = e.team_id
       left join nhl_players p on p.id = e.scorer_id left join nhl_players a1 on a1.id = e.assist1_id left join nhl_players a2 on a2.id = e.assist2_id
       where e.game_id = $1 order by e.period, e.time_in_period_sec, e.event_id`,
      [gameId],
    ),
    pool.query(
      `select e.period, e.time_in_period_sec, t.tri_code as team, p.full_name as player, e.minutes, e.infraction
       from nhl_penalty_events e left join nhl_teams t on t.id = e.team_id left join nhl_players p on p.id = e.player_id
       where e.game_id = $1 order by e.period, e.time_in_period_sec, e.event_id`,
      [gameId],
    ),
    pool.query(`select period, period_type, home_goals, away_goals, home_shots, away_shots from nhl_period_scores where game_id = $1 order by period`, [gameId]),
    pool.query(`select label, short_story, featurable from iconic_games where game_id = $1`, [gameId]),
    pool.query(`select label from game_labels where game_id = $1 order by fame_points desc`, [gameId]),
    pool.query(`select max((id / 100) % 10) as m from nhl_games where season = $1 and game_type = 'playoff'`, [g.season]),
  ]);
  const parts = playoffParts(g.id);
  const year = g.season.slice(4);
  return {
    id: g.id,
    season: g.season,
    gameType: g.game_type,
    date: g.date,
    venue: g.venue_name,
    city: g.venue_city,
    home: { id: g.home_team_id, code: g.home_code, name: g.home_name, score: g.home_score, sog: g.home_sog },
    away: { id: g.away_team_id, code: g.away_code, name: g.away_name, score: g.away_score, sog: g.away_sog },
    finalState: g.final_state,
    otPeriods: g.ot_periods,
    tier: g.tier,
    hasStrength: g.has_strength,
    stage: g.game_type === "playoff" ? `${year} ${roundName(g.season, parts.round, Number(maxRound[0]?.m ?? parts.round), parts.series)}, Game ${parts.game}` : null,
    goals: goals.map((r) => ({
      period: r.period,
      periodType: r.period_type,
      time: clock(r.time_in_period_sec),
      team: r.team,
      scorer: r.scorer,
      scorerId: r.scorer_id,
      assists: [r.a1, r.a2].filter(Boolean),
      strength: r.strength,
      emptyNet: r.empty_net,
      homeAfter: r.score_before_home + (r.team_id === g.home_team_id ? 1 : 0),
      awayAfter: r.score_before_away + (r.team_id === g.away_team_id ? 1 : 0),
    })),
    penalties: pens.map((r) => ({ period: r.period, time: clock(r.time_in_period_sec), team: r.team, player: r.player, minutes: r.minutes, infraction: r.infraction })),
    periods: periods.map((r) => ({ period: r.period, periodType: r.period_type, home: r.home_goals, away: r.away_goals, homeShots: r.home_shots, awayShots: r.away_shots })),
    iconic: iconic[0] ? { label: iconic[0].label, story: iconic[0].short_story, featurable: iconic[0].featurable } : null,
    labels: labels.map((r) => r.label),
  };
}

// The team's previous and next games around a historical one (by date).
export async function getHistoryAdjacent(gameId: number, teamId: number): Promise<{ prev: { id: number; date: string; label: string } | null; next: { id: number; date: string; label: string } | null }> {
  const { rows } = await pool.query(
    `with tg as (
       select g.id, g.game_date, case when g.home_team_id = $2 then 'vs ' || at.tri_code else '@ ' || ht.tri_code end as label,
              lag(g.id) over w as prev_id, lead(g.id) over w as next_id
       from nhl_games g join nhl_teams ht on ht.id = g.home_team_id join nhl_teams at on at.id = g.away_team_id
       where g.home_team_id = $2 or g.away_team_id = $2 window w as (order by g.game_date, g.id))
     select t.id, t.game_date::text as date, t.label, t.id = c.prev_id as is_prev
     from tg c join tg t on t.id in (c.prev_id, c.next_id) where c.id = $1`,
    [gameId, teamId],
  );
  const pick = (prev: boolean) => {
    const r = rows.find((x) => x.is_prev === prev);
    return r ? { id: r.id, date: r.date, label: r.label } : null;
  };
  return { prev: pick(true), next: pick(false) };
}

export type HistorySeries = {
  seasonId: string;
  round: number;
  roundName: string;
  opponentAbbrev: string;
  opponentName: string;
  opponentLinkable: boolean;
  won: boolean;
  teamWins: number;
  opponentWins: number;
  ties: number;
  maxRoundThatSeason: number;
  decidedOnGoals: boolean; // early total-goals series where wins were level
  games: { id: number; teamScore: number; oppScore: number; end: string }[];
};

const ACTIVE = new Set(["ANA", "BOS", "BUF", "CAR", "CBJ", "CGY", "CHI", "COL", "DAL", "DET", "EDM", "FLA", "LAK", "MIN", "MTL", "NJD", "NSH", "NYI", "NYR", "OTT", "PHI", "PIT", "SEA", "SJS", "STL", "TBL", "TOR", "UTA", "VAN", "VGK", "WPG", "WSH"]);

// A team's playoff series before 2007-08 (the site's own playoff tables
// start there), from the history. Most early series were best-of-N, but
// some (into the 1930s) were two games on total goals, so a series with
// level wins is decided on goals, and flagged as such.
export async function getHistoricalPlayoffSeries(teamId: number): Promise<HistorySeries[]> {
  const { rows } = await pool.query(
    `select g.id, g.season,
            (g.id / 100) % 10 as round, (g.id / 10) % 10 as series,
            case when g.home_team_id = $1 then g.home_score else g.away_score end as team_score,
            case when g.home_team_id = $1 then g.away_score else g.home_score end as opp_score,
            case when g.home_team_id = $1 then at.tri_code else ht.tri_code end as opp_code,
            case when g.home_team_id = $1 then at.full_name else ht.full_name end as opp_name,
            case when g.home_team_id = $1 then at.franchise_id else ht.franchise_id end as opp_franchise,
            g.final_state,
            (select max((x.id / 100) % 10) from nhl_games x where x.season = g.season and x.game_type = 'playoff') as max_round
     from nhl_games g join nhl_teams ht on ht.id = g.home_team_id join nhl_teams at on at.id = g.away_team_id
     where g.game_type = 'playoff' and g.season < $2 and (g.home_team_id = $1 or g.away_team_id = $1)
     order by g.season, g.id`,
    [teamId, BOX_SCORES_FROM],
  );
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.season}|${r.round}|${r.series}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const { rows: activeFranchises } = await pool.query(`select tri_code, franchise_id from nhl_teams t join nhl_franchises f on f.id = t.franchise_id where f.last_season is null`);
  const currentFranchise = new Map(activeFranchises.map((r) => [r.tri_code as string, Number(r.franchise_id)]));

  return [...groups.values()].map((gs) => {
    const first = gs[0];
    const teamWins = gs.filter((g) => g.team_score > g.opp_score).length;
    const opponentWins = gs.filter((g) => g.team_score < g.opp_score).length;
    const ties = gs.length - teamWins - opponentWins;
    const goalsFor = gs.reduce((s, g) => s + g.team_score, 0);
    const goalsAgainst = gs.reduce((s, g) => s + g.opp_score, 0);
    const decidedOnGoals = teamWins === opponentWins;
    const won = decidedOnGoals ? goalsFor > goalsAgainst : teamWins > opponentWins;
    const code = first.opp_code as string;
    return {
      seasonId: first.season,
      round: Number(first.round),
      roundName: roundName(first.season, Number(first.round), Number(first.max_round), Number(first.series)),
      opponentAbbrev: code,
      opponentName: first.opp_name,
      // Link only when the code is today's team AND the same franchise
      // (the 1927 Senators aren't today's Senators).
      opponentLinkable: ACTIVE.has(code) && currentFranchise.get(code) === Number(first.opp_franchise),
      won,
      teamWins,
      opponentWins,
      ties,
      maxRoundThatSeason: Number(first.max_round),
      decidedOnGoals,
      games: gs.map((g) => ({ id: g.id, teamScore: g.team_score, oppScore: g.opp_score, end: g.team_score === g.opp_score ? "tie" : g.final_state === "OT" ? "overtime" : "regulation" })),
    };
  });
}
