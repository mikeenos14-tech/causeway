import { pool } from "./db";
import { ELO, eraOf } from "../config/stats";

// Pregame win chances from the Elo ratings (config ELO.winProb has the fit
// and how it tested on seasons it never saw). Regular season only: the
// curve was fitted on regular-season games. Ratings are each franchise's
// current Elo (elo_current, rebuilt daily), so a game the same day as a
// prior game uses ratings from before that game.

export type EloOdds = { home: number; away: number; homeRating: number; awayRating: number; asOf: string };

export function winChance(homeRating: number, awayRating: number, season: string): number {
  const gap = homeRating - awayRating + (ELO.params.homeIce[eraOf(season).id] ?? 0);
  return 1 / (1 + Math.exp(-(ELO.winProb.intercept + ELO.winProb.slope * gap)));
}

export async function getEloOdds(awayTeamId: number, homeTeamId: number, season: string, gameType: number): Promise<EloOdds | null> {
  if (gameType !== 2) return null;
  const { rows } = await pool.query(
    `select t.id, c.rating::float as rating, c.last_game_date::text as as_of
     from nhl_teams t join elo_current c on c.franchise_id = t.lineage_id where t.id = any($1::int[])`,
    [[awayTeamId, homeTeamId]],
  );
  const away = rows.find((r) => Number(r.id) === awayTeamId), home = rows.find((r) => Number(r.id) === homeTeamId);
  if (!away || !home) return null;
  const p = winChance(home.rating, away.rating, season);
  return { home: p, away: 1 - p, homeRating: home.rating, awayRating: away.rating, asOf: [home.as_of, away.as_of].sort().at(-1)! };
}

// The same, by team code (the home page's next-game card has codes).
export async function getEloOddsByAbbrev(awayAbbrev: string, homeAbbrev: string, season: string, gameType: number): Promise<EloOdds | null> {
  const { rows } = await pool.query(`select id, abbrev from teams where is_active and abbrev = any($1)`, [[awayAbbrev, homeAbbrev]]);
  const id = (a: string) => rows.find((r) => r.abbrev === a)?.id;
  if (!id(awayAbbrev) || !id(homeAbbrev)) return null;
  return getEloOdds(Number(id(awayAbbrev)), Number(id(homeAbbrev)), season, gameType);
}
