import { pool } from "./db";
import { ELO, eraOf } from "../config/stats";

// Pregame win chances from the Elo ratings (config ELO.winProb has the fit
// and how it tested on seasons it never saw). Regular season only: the
// curve was fitted on regular-season games. Ratings are each franchise's
// current Elo (elo_current, rebuilt daily), so a game the same day as a
// prior game uses ratings from before that game.

export type EloOdds = { home: number; away: number; homeRating: number; awayRating: number; asOf: string; b2b: { home: boolean; away: boolean } };

export function winChance(homeRating: number, awayRating: number, season: string, b2b: { home: boolean; away: boolean } = { home: false, away: false }): number {
  // A team on the second night of a back-to-back plays below its rating.
  const pen = ELO.params.b2bPenalty ?? 0;
  const gap = homeRating - (b2b.home ? pen : 0) - (awayRating - (b2b.away ? pen : 0)) + (ELO.params.homeIce[eraOf(season).id] ?? 0);
  return 1 / (1 + Math.exp(-(ELO.winProb.intercept + ELO.winProb.slope * gap)));
}

// Each team's current rating and whether it's on the second night of a
// back-to-back (played the previous Eastern date). startTimeUTC: the
// game's start; without it, no back-to-back. Any game type (the live win
// probability uses it for playoff games too).
export type EloMatchup = { homeRating: number; awayRating: number; asOf: string; b2b: { home: boolean; away: boolean } };

export async function getEloMatchup(awayTeamId: number, homeTeamId: number, startTimeUTC?: string): Promise<EloMatchup | null> {
  let b2b = { home: false, away: false };
  if (startTimeUTC) {
    const et = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(startTimeUTC));
    const { rows: prev } = await pool.query(
      `select t.id, exists (select 1 from nhl_games g where t.id in (g.home_team_id, g.away_team_id) and g.game_date = $2::date - 1) as played
       from unnest($1::int[]) t(id)`,
      [[awayTeamId, homeTeamId], et],
    );
    b2b = { home: !!prev.find((r) => Number(r.id) === homeTeamId)?.played, away: !!prev.find((r) => Number(r.id) === awayTeamId)?.played };
  }
  const { rows } = await pool.query(
    `select t.id, c.rating::float as rating, c.last_game_date::text as as_of
     from nhl_teams t join elo_current c on c.franchise_id = t.lineage_id where t.id = any($1::int[])`,
    [[awayTeamId, homeTeamId]],
  );
  const away = rows.find((r) => Number(r.id) === awayTeamId), home = rows.find((r) => Number(r.id) === homeTeamId);
  if (!away || !home) return null;
  return { homeRating: home.rating, awayRating: away.rating, asOf: [home.as_of, away.as_of].sort().at(-1)!, b2b };
}

// Regular season only: the curve was fitted on regular-season games.
export async function getEloOdds(awayTeamId: number, homeTeamId: number, season: string, gameType: number, startTimeUTC?: string): Promise<EloOdds | null> {
  if (gameType !== 2) return null;
  const m = await getEloMatchup(awayTeamId, homeTeamId, startTimeUTC);
  if (!m) return null;
  const p = winChance(m.homeRating, m.awayRating, season, m.b2b);
  return { home: p, away: 1 - p, ...m };
}

// The same, by team code (the home page's next-game card has codes).
export async function getEloOddsByAbbrev(awayAbbrev: string, homeAbbrev: string, season: string, gameType: number, startTimeUTC?: string): Promise<EloOdds | null> {
  const { rows } = await pool.query(`select id, abbrev from teams where is_active and abbrev = any($1)`, [[awayAbbrev, homeAbbrev]]);
  const id = (a: string) => rows.find((r) => r.abbrev === a)?.id;
  if (!id(awayAbbrev) || !id(homeAbbrev)) return null;
  return getEloOdds(Number(id(awayAbbrev)), Number(id(homeAbbrev)), season, gameType, startTimeUTC);
}
