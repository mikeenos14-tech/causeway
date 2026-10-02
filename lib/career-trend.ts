// The player page's career-trend line: one point per season, as a RATE
// (points per game for skaters, save % for goalies), never a total. Totals
// made every short season look like a collapse: the season just started, a
// 48-game lockout year, the 56-game 2020-21 season, an injury year.
//
// Rules:
//   - a trade season's rows (one per team) are combined into one season
//     (points and games summed; save % re-weighted by shots against)
//   - seasons with fewer than MIN_GAMES games aren't charted: a 3-game
//     call-up is noise, not trajectory (the season table still lists them)
//   - the season in progress is held back until MIN_GAMES games, then shown
//     as a hollow "so far" point; one game in, even a rate is a coin flip

export const MIN_GAMES = 10;

type SkaterRow = { season_id: string; games: number; points: number };
type GoalieRow = { season_id: string; games: number; saves: number; shots_against: number };

export type TrendPoint = { seasonId: string; value: number; games: number; inProgress: boolean };
export type CareerTrend = { points: TrendPoint[]; pending: { seasonId: string; games: number } | null };

export function buildCareerTrend(rows: (SkaterRow | GoalieRow)[], isGoalie: boolean, inProgressSeason: string | null): CareerTrend {
  const bySeason = new Map<string, { games: number; points: number; saves: number; shotsAgainst: number }>();
  for (const r of rows) {
    const e = bySeason.get(r.season_id) ?? { games: 0, points: 0, saves: 0, shotsAgainst: 0 };
    e.games += Number(r.games);
    if (isGoalie) {
      e.saves += Number((r as GoalieRow).saves);
      e.shotsAgainst += Number((r as GoalieRow).shots_against);
    } else {
      e.points += Number((r as SkaterRow).points);
    }
    bySeason.set(r.season_id, e);
  }

  const points: TrendPoint[] = [];
  let pending: CareerTrend["pending"] = null;
  for (const [seasonId, e] of [...bySeason.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const inProgress = seasonId === inProgressSeason;
    if (e.games < MIN_GAMES) {
      if (inProgress) pending = { seasonId, games: e.games };
      continue;
    }
    if (isGoalie && e.shotsAgainst === 0) continue;
    points.push({ seasonId, value: isGoalie ? e.saves / e.shotsAgainst : e.points / e.games, games: e.games, inProgress });
  }
  return { points, pending };
}

// The NHL season a date falls in, by the calendar (a season starts in
// September). Only a fallback for when the NHL schedule can't be reached.
export function seasonByDate(now: Date): string {
  const y = now.getUTCFullYear();
  const start = now.getUTCMonth() >= 8 ? y : y - 1;
  return `${start}${start + 1}`;
}
