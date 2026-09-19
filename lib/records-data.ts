import { pool } from "./db";

export type TeamResult = {
  id: number;
  game_date: string | Date;
  season_id: string;
  team_score: number;
  opp_score: number;
  opp_abbrev: string;
  game_end_type: string;
};

// Every record/streak on this page is derived from one ordered list of
// regular-season results, computed in JS rather than as five separate
// SQL window-function queries — cheaper to write, cheaper to verify, and
// the full history for one team is a few thousand rows at most.
export async function getAllRegularSeasonResults(teamAbbrev: string): Promise<TeamResult[]> {
  const { rows } = await pool.query(
    `select g.id, g.game_date, g.season_id,
            case when ht.abbrev = $1 then g.home_score else g.away_score end as team_score,
            case when ht.abbrev = $1 then g.away_score else g.home_score end as opp_score,
            case when ht.abbrev = $1 then at.abbrev else ht.abbrev end as opp_abbrev,
            g.game_end_type
     from games g
     join teams ht on ht.id = g.home_team_id
     join teams at on at.id = g.away_team_id
     where (ht.abbrev = $1 or at.abbrev = $1) and g.game_type = 'regular'
     order by g.game_date asc`,
    [teamAbbrev],
  );
  return rows;
}

export type Streak = { length: number; startDate: string | Date; endDate: string | Date; seasonId: string };

// Streaks reset at a season boundary — otherwise the last win of one
// regular season and the first win of the next chain together into one
// "streak" spanning the entire off-season, which no real hockey record
// book counts (found live: a 14-gamer reported as running from
// late March to late October).
export function longestWinStreak(results: TeamResult[]): Streak | null {
  let best: Streak | null = null;
  let cur: Streak | null = null;
  for (const r of results) {
    const won = r.team_score > r.opp_score;
    if (cur && cur.seasonId !== r.season_id) cur = null;
    if (won) {
      if (cur) {
        cur.length += 1;
        cur.endDate = r.game_date;
      } else {
        cur = { length: 1, startDate: r.game_date, endDate: r.game_date, seasonId: r.season_id };
      }
      if (!best || cur.length > best.length) best = { ...cur };
    } else {
      cur = null;
    }
  }
  return best;
}

// A "point streak" is the hockey-broadcast staple: any game that isn't a
// regulation loss (a win, an OT loss, or a shootout loss) keeps it alive,
// since all three put a point in the standings.
export function longestPointStreak(results: TeamResult[]): Streak | null {
  let best: Streak | null = null;
  let cur: Streak | null = null;
  for (const r of results) {
    const earnedPoint = r.team_score > r.opp_score || r.game_end_type === "overtime" || r.game_end_type === "shootout";
    if (cur && cur.seasonId !== r.season_id) cur = null;
    if (earnedPoint) {
      if (cur) {
        cur.length += 1;
        cur.endDate = r.game_date;
      } else {
        cur = { length: 1, startDate: r.game_date, endDate: r.game_date, seasonId: r.season_id };
      }
      if (!best || cur.length > best.length) best = { ...cur };
    } else {
      cur = null;
    }
  }
  return best;
}

export function biggestWin(results: TeamResult[]): TeamResult | null {
  let best: TeamResult | null = null;
  for (const r of results) {
    if (r.team_score > r.opp_score && (!best || r.team_score - r.opp_score > best.team_score - best.opp_score)) best = r;
  }
  return best;
}

export function worstLoss(results: TeamResult[]): TeamResult | null {
  let worst: TeamResult | null = null;
  for (const r of results) {
    if (r.team_score < r.opp_score && (!worst || r.opp_score - r.team_score > worst.opp_score - worst.team_score)) worst = r;
  }
  return worst;
}

export type MonthRecord = { label: string; points: number; wins: number; losses: number; otl: number; games: number };

// Points-per-game, not raw points, decides "best month" — otherwise a
// 4-game December would always lose to an 8-game January regardless of
// how the team actually played.
export function bestAndWorstMonth(results: TeamResult[]): { best: MonthRecord | null; worst: MonthRecord | null } {
  const byMonth = new Map<string, MonthRecord>();
  for (const r of results) {
    const d = r.game_date instanceof Date ? r.game_date : new Date(r.game_date);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    const entry = byMonth.get(key) ?? { label, points: 0, wins: 0, losses: 0, otl: 0, games: 0 };
    entry.games++;
    if (r.team_score > r.opp_score) {
      entry.wins++;
      entry.points += 2;
    } else if (r.game_end_type === "overtime" || r.game_end_type === "shootout") {
      entry.otl++;
      entry.points += 1;
    } else {
      entry.losses++;
    }
    byMonth.set(key, entry);
  }
  const months = [...byMonth.values()].filter((m) => m.games >= 3);
  if (months.length === 0) return { best: null, worst: null };
  const best = months.reduce((a, b) => (b.points / b.games > a.points / a.games ? b : a));
  const worst = months.reduce((a, b) => (b.points / b.games < a.points / a.games ? b : a));
  return { best, worst };
}
