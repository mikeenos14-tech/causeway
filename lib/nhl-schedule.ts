// A team's full current-season schedule, live from the NHL API — the one
// place the site learns about games that haven't been played yet. Our own
// database deliberately only holds completed games (see
// scripts/backfill-season.ts), so without this the Schedule page could only
// ever list results, and the homepage had no idea a new season had begun
// until the first boxscore landed hours after the opener ended.
//
// Also the source of truth for "what season is it": the API's
// currentSeason flips to the new season in the offseason, well before any
// game is loaded into the database.

import { nhlJson } from "./nhl-fetch";

const API = "https://api-web.nhle.com/v1";

const CANADIAN_TEAMS = new Set(["TOR", "MTL", "OTT", "WPG", "CGY", "EDM", "VAN"]);

// OVER: the horn has gone but the result isn't official yet (seen on the
// recorded 2026-10-01 games, for up to a minute before FINAL). Still in
// progress here, so the live board stays up.
export type GameState = "FUT" | "PRE" | "LIVE" | "CRIT" | "OVER" | "FINAL" | "OFF";

export type ClubGame = {
  id: number;
  season: string;
  gameType: 2 | 3;
  gameDate: string; // YYYY-MM-DD, local to the venue
  startTimeUTC: string;
  venue: string;
  isHome: boolean;
  opponent: string;
  opponentName: string; // the API's commonName, e.g. "Rangers"
  state: GameState;
  teamScore: number | null;
  oppScore: number | null;
  endType: "regulation" | "overtime" | "shootout" | null;
  tv: string[];
};

export type ClubSeason = {
  currentSeason: string;
  previousSeason: string;
  teamName: string | null; // this team's commonName, e.g. "Bruins"
  games: ClubGame[]; // regular season and playoffs only, in date order
};

type ApiTeam = { abbrev: string; score?: number; commonName?: { default?: string } };
type ApiGame = {
  id: number;
  season: number;
  gameType: number;
  gameDate: string;
  startTimeUTC: string;
  venue?: { default?: string };
  gameState: string;
  homeTeam: ApiTeam;
  awayTeam: ApiTeam;
  gameOutcome?: { lastPeriodType?: string };
  tvBroadcasts?: { market: string; countryCode: string; network: string }[];
};

export async function getClubSeason(teamAbbrev: string): Promise<ClubSeason | null> {
  try {
    // Five minutes, matching the pages' own revalidate — short enough that
    // a game going final shows up promptly, long enough to be cheap.
    // Retries temporary failures (lib/nhl-fetch.ts); a lasting outage
    // throws into the catch below, and pages fall back to the database.
    const data = await nhlJson<{ games?: ApiGame[]; currentSeason?: number; previousSeason?: number }>(`${API}/club-schedule-season/${teamAbbrev}/now`, 300);
    if (!data) return null;
    const games: ClubGame[] = (data.games ?? [])
      .filter((g: ApiGame) => g.gameType === 2 || g.gameType === 3)
      .map((g: ApiGame) => {
        const isHome = g.homeTeam.abbrev === teamAbbrev;
        const own = isHome ? g.homeTeam : g.awayTeam;
        const opp = isHome ? g.awayTeam : g.homeTeam;
        const last = g.gameOutcome?.lastPeriodType;
        // National broadcasts in this team's own country plus its local
        // feed — what a fan of this team actually tunes to. Other clubs'
        // local networks are noise here.
        const country = CANADIAN_TEAMS.has(teamAbbrev) ? "CA" : "US";
        const tv = (g.tvBroadcasts ?? [])
          .filter((b) => (b.market === "N" && b.countryCode === country) || b.market === (isHome ? "H" : "A"))
          .map((b) => b.network);
        return {
          id: g.id,
          season: String(g.season),
          gameType: g.gameType as 2 | 3,
          gameDate: g.gameDate,
          startTimeUTC: g.startTimeUTC,
          venue: g.venue?.default ?? "",
          isHome,
          opponent: opp.abbrev,
          opponentName: opp.commonName?.default ?? opp.abbrev,
          state: g.gameState as GameState,
          teamScore: own.score ?? null,
          oppScore: opp.score ?? null,
          endType: last === "SO" ? "shootout" : last === "OT" ? "overtime" : last === "REG" ? "regulation" : null,
          tv: [...new Set(tv)],
        };
      });
    const any = (data.games ?? [])[0] as ApiGame | undefined;
    const own = any ? (any.homeTeam.abbrev === teamAbbrev ? any.homeTeam : any.awayTeam) : null;
    return {
      currentSeason: String(data.currentSeason),
      previousSeason: String(data.previousSeason),
      teamName: own?.commonName?.default ?? null,
      games,
    };
  } catch (err) {
    console.error(`getClubSeason(${teamAbbrev}) failed (non-fatal — callers fall back to database-only views):`, err);
    return null;
  }
}

export const isUpcoming = (g: ClubGame) => g.state === "FUT" || g.state === "PRE";
export const isInProgress = (g: ClubGame) => g.state === "LIVE" || g.state === "CRIT" || g.state === "OVER";
export const isFinal = (g: ClubGame) => g.state === "FINAL" || g.state === "OFF";

// "Tue, Sep 29 · 8:00 PM ET". Converting a real UTC instant to Eastern is
// the one legitimate timezone conversion on the site — unlike stored game
// dates (copied as-is, see format-date.ts), a start time is an instant.
export function formatStartTimeET(startTimeUTC: string, withDate = true): string {
  const d = new Date(startTimeUTC);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(d);
  if (!withDate) return `${time} ET`;
  const date = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" }).format(d);
  return `${date} · ${time} ET`;
}

// The first regular-season game of the season, and the first at home — the
// two games fans and broadcasts actually call out by name.
export function openerTag(season: ClubSeason, game: ClubGame): "Opening Night" | "Home Opener" | null {
  if (game.gameType !== 2) return null;
  const regular = season.games.filter((g) => g.gameType === 2 && g.season === game.season);
  if (regular[0]?.id === game.id) return "Opening Night";
  if (game.isHome && regular.find((g) => g.isHome)?.id === game.id) return "Home Opener";
  return null;
}

export type HeroChoice = {
  hero: "pending" | "preview" | "recap" | "none";
  pending: ClubGame | null;
  next: ClubGame | null;
  daysSinceLast: number;
};

// What the dashboard's hero shows, as a pure function of the live schedule,
// the latest game in our database, and the clock — kept out of the
// component so every game-night state can be tested (see
// scripts/test-hero-states.ts):
//   pending  a game is live, or final on the NHL's side but not yet in our
//            database (the hourly refresh hasn't run) — otherwise the hero
//            would jump from "Tonight" to the following game at puck drop
//   preview  the next game, when it's within 30 hours or the last game is
//            3+ days old (game days, and the whole offseason)
//   recap    the latest loaded game
// lastGame.startedAt (the real start time) when known: days since the last
// game used to count from midnight UTC of its date, which made a Tuesday
// 7 PM game "3 days old" by Thursday 8 PM Eastern (found live 2026-10-01,
// when the homepage's "Last game" button vanished a day early).
export function chooseHero(games: ClubGame[], lastGame: { id: number; date: string; startedAt?: string | null } | null, now: number): HeroChoice {
  const pending =
    games.find(isInProgress) ??
    [...games]
      .reverse()
      .find(
        (g) =>
          isFinal(g) &&
          g.id !== lastGame?.id &&
          (!lastGame || g.gameDate > lastGame.date) &&
          now - Date.parse(g.startTimeUTC) < 36 * 3600 * 1000,
      ) ??
    null;
  const next = games.find(isUpcoming) ?? null;
  const hoursToNext = next ? (Date.parse(next.startTimeUTC) - now) / 3.6e6 : Infinity;
  const daysSinceLast = lastGame ? (now - Date.parse(lastGame.startedAt ?? lastGame.date)) / 8.64e7 : Infinity;
  const hero = pending
    ? "pending"
    : next && (hoursToNext <= 30 || daysSinceLast >= 3 || !lastGame)
      ? "preview"
      : lastGame
        ? "recap"
        : "none";
  return { hero, pending, next, daysSinceLast };
}
