import { pool } from "./db";
import { BOS_TEAM_ID, getHistoricalPlayoffSeries } from "./history-data";
import { getPlayoffHistory, roundLabel } from "./playoff-data";
import { getBruinsSeasonLines } from "./history-hub-data";

// Every Bruins season ranked by Elo (elo_history, rebuilt daily): peak
// rating, regular-season average, and the rating after the season's last
// game. Elo is relative to each season's league (the league average is
// held at 1505), so this ranks how dominant a team was in its own time,
// not how it would fare against another era's teams.

export type EloSeason = { seasonId: string; peak: number; avg: number; final: number; record: string; outcome: string; cup: boolean; current: boolean };

export async function getBruinsEloSeasons(): Promise<EloSeason[]> {
  const [{ rows }, older, modern] = await Promise.all([
    pool.query(
      `select g.season, max(h.rating_after)::float as peak, avg(h.rating_after) filter (where g.game_type = 'regular')::float as avg,
              (array_agg(h.rating_after order by h.date desc, h.game_id desc))[1]::float as final
       from elo_history h join nhl_games g on g.id = h.game_id
       where h.franchise_id = (select lineage_id from nhl_teams where id = $1)
       group by g.season`,
      [BOS_TEAM_ID],
    ),
    getHistoricalPlayoffSeries(BOS_TEAM_ID),
    getPlayoffHistory("BOS"),
  ]);
  // The furthest series each season, in play order (two can share a round).
  const series = [
    ...older.map((s) => ({ seasonId: s.seasonId, firstGame: s.games[0]?.id ?? 0, won: s.won, isFinal: s.round === s.maxRoundThatSeason, label: s.roundName })),
    ...modern.map((s) => ({ seasonId: s.seasonId, firstGame: s.games[0]?.id ?? 0, won: s.won, isFinal: s.round === s.maxRoundThatSeason, label: roundLabel(s.round, s.maxRoundThatSeason) })),
  ];
  const last = new Map<string, (typeof series)[number]>();
  for (const s of series.sort((a, b) => a.firstGame - b.firstGame)) last.set(s.seasonId, s);
  const cups = new Set([...last.values()].filter((s) => s.won && s.isFinal && s.seasonId >= "19261927").map((s) => s.seasonId));
  const lines = new Map((await getBruinsSeasonLines(cups)).map((l) => [l.seasonId, l]));
  const latest = [...lines.keys()].sort().at(-1);
  return rows
    .map((r) => {
      const s = last.get(r.season);
      const l = lines.get(r.season);
      const outcome = !s ? "Missed the playoffs" : cups.has(r.season) ? "Won the Stanley Cup" : s.won && s.isFinal ? "Won the NHL title" : s.isFinal ? "Lost in the Final" : s.label ? `Lost in the ${s.label}` : "Made the playoffs";
      return { seasonId: r.season, peak: r.peak, avg: r.avg, final: r.final, record: l?.record ?? "", outcome: r.season === latest ? "In progress" : outcome, cup: cups.has(r.season), current: r.season === latest };
    })
    .sort((a, b) => b.peak - a.peak);
}
