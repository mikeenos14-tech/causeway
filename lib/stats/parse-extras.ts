// Turning boxscores and standings responses into rows, shared by the
// one-time backfill (scripts/stats/load-nhl-extras.ts) and the hourly
// ingest (scripts/stats/ingest-recent-games.ts) so both read the feed the
// same way.

/* eslint-disable @typescript-eslint/no-explicit-any -- the NHL feed is untyped JSON */

export const GOALIE_COLS = ["game_id", "player_id", "team_id", "started", "decision", "toi_sec", "shots_against", "saves", "goals_against"];
export const STANDINGS_COLS = ["date", "season", "team_id", "games_played", "wins", "losses", "ot_losses", "ties", "points", "goals_for", "goals_against", "division", "conference", "division_rank", "conference_rank", "league_rank", "wildcard_rank"];

const toSec = (t?: string) => {
  const m = /^(\d+):(\d{2})$/.exec(t ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

export function goalieRows(box: any, g: { id: number; game_type: string; home_team_id: number; away_team_id: number }): unknown[][] {
  const out: unknown[][] = [];
  for (const [side, teamId] of [["homeTeam", g.home_team_id], ["awayTeam", g.away_team_id]] as const) {
    const goalies: any[] = box?.playerByGameStats?.[side]?.goalies ?? [];
    const played = goalies.filter((x) => (toSec(x.toi) ?? 0) > 0);
    // The feed's starter flag when present; otherwise the goalie with the
    // most ice time.
    const flagged = played.find((x) => x.starter === true);
    const starter = flagged ?? [...played].sort((a, b) => (toSec(b.toi) ?? 0) - (toSec(a.toi) ?? 0))[0];
    for (const x of played) {
      // "O" is an OT/SO loss; playoffs have no OTL (same rule as the site).
      const d = x.decision === "W" ? "W" : x.decision === "L" ? "L" : x.decision === "O" ? (g.game_type === "playoff" ? "L" : "OTL") : x.decision === "T" ? "T" : null;
      out.push([g.id, x.playerId, teamId, x === starter, d, toSec(x.toi), x.shotsAgainst ?? null, x.saves ?? null, x.goalsAgainst ?? null]);
    }
  }
  return out;
}

// The standings feed spells a few old clubs differently from the game
// feed. Each alias is checked against the season's games (the Cleveland
// Barons played 1976-78 as CLE in games, CBN in standings).
const STANDINGS_ALIASES: Record<string, string> = { CBN: "CLE" };

// idFor resolves "season|TRI" to a team id (codes are reused over time).
export function standingsRows(data: any, date: string, idFor: Map<string, number>, unresolved?: Set<string>): unknown[][] {
  const out: unknown[][] = [];
  for (const s of data?.standings ?? []) {
    const season = String(s.seasonId);
    const raw = s.teamAbbrev?.default;
    const abbrev = STANDINGS_ALIASES[raw] && idFor.has(`${season}|${STANDINGS_ALIASES[raw]}`) ? STANDINGS_ALIASES[raw] : raw;
    const teamId = idFor.get(`${season}|${abbrev}`) ?? idFor.get(`*|${abbrev}`);
    if (!teamId) {
      unresolved?.add(`${season} ${abbrev}`);
      continue;
    }
    out.push([date, season, teamId, s.gamesPlayed, s.wins, s.losses, s.otLosses ?? 0, s.ties ?? 0, s.points, s.goalFor ?? null, s.goalAgainst ?? null, s.divisionName ?? null, s.conferenceName ?? null, s.divisionSequence || null, s.conferenceSequence || null, s.leagueSequence || null, s.wildcardSequence || null]);
  }
  return out;
}

// Season-scoped team code lookup from the games actually played, plus each
// active franchise's current team for every season (key "*|TRI"): early in
// a season most teams haven't played yet, and only resolving teams that
// had once left 17 of 32 out of the standings (the same failure the site's
// standings had after the 2026-27 opener).
export const TEAM_CODES_SQL = `select distinct g.season, t.tri_code, t.id from nhl_games g
  join nhl_teams t on t.id in (g.home_team_id, g.away_team_id) where g.game_type = 'regular'
  union all
  select '*', t.tri_code, max(t.id) from nhl_teams t join nhl_franchises f on f.id = t.franchise_id
  where f.last_season is null group by t.tri_code`;
