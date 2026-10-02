import { pool } from "./db";
import { BOS_TEAM_ID, eraRecord, getHistoricalPlayoffSeries } from "./history-data";
import { getPlayoffHistory } from "./playoff-data";

// Data for /history: the Bruins' Cups, their iconic games and every season's
// record, all from the audited 1917-on history tables (nhl_*) plus the
// site's own playoff tables for 2007-08 on (the 2011 Cup).

export type Cup = { seasonId: string; year: string; opponentName: string; teamWins: number; opponentWins: number; clincherId: number; clincherLabel: string | null };

export async function getBruinsCups(): Promise<Cup[]> {
  const [older, modern] = await Promise.all([getHistoricalPlayoffSeries(BOS_TEAM_ID), getPlayoffHistory("BOS")]);
  const finals = [
    ...older.filter((s) => s.won && s.round === s.maxRoundThatSeason && s.seasonId >= "19261927"),
    ...modern.filter((s) => s.won && s.round === s.maxRoundThatSeason),
  ];
  const ids = finals.map((s) => s.games.at(-1)?.id).filter((id): id is number => id != null);
  const { rows } = await pool.query(`select game_id, label from iconic_games where game_id = any($1::bigint[]) and featurable`, [ids]);
  const label = new Map(rows.map((r) => [Number(r.game_id), r.label as string]));
  return finals
    .map((s) => {
      const clincherId = s.games.at(-1)!.id;
      return { seasonId: s.seasonId, year: s.seasonId.slice(4), opponentName: s.opponentName, teamWins: s.teamWins, opponentWins: s.opponentWins, clincherId, clincherLabel: label.get(clincherId) ?? null };
    })
    .sort((a, b) => a.seasonId.localeCompare(b.seasonId));
}

export type IconicGame = { id: number; date: string; season: string; label: string; story: string; opponent: string; isHome: boolean; team: number; opp: number; finalState: string; otPeriods: number };

// The featured iconic Bruins games (curated, each verified against the
// game record; see config/iconic-games.ts on the stats branch).
export async function getBruinsIconicGames(): Promise<IconicGame[]> {
  const { rows } = await pool.query(
    `select g.id, g.game_date::text as date, g.season, i.label, i.short_story,
            g.home_team_id = $1 as is_home,
            case when g.home_team_id = $1 then at.tri_code else ht.tri_code end as opponent,
            case when g.home_team_id = $1 then g.home_score else g.away_score end as team,
            case when g.home_team_id = $1 then g.away_score else g.home_score end as opp,
            g.final_state, g.ot_periods
     from iconic_games i join nhl_games g on g.id = i.game_id
     join nhl_teams ht on ht.id = g.home_team_id join nhl_teams at on at.id = g.away_team_id
     where i.featurable and (g.home_team_id = $1 or g.away_team_id = $1)
     order by g.game_date desc, g.id desc`,
    [BOS_TEAM_ID],
  );
  return rows.map((r) => ({ id: Number(r.id), date: r.date, season: r.season, label: r.label, story: r.short_story, opponent: r.opponent, isHome: r.is_home, team: r.team, opp: r.opp, finalState: r.final_state, otPeriods: r.ot_periods ?? 0 }));
}

export type SeasonLine = { seasonId: string; record: string; games: number; cup: boolean; playoffs: boolean };

// Every Bruins season's regular-season record, in that era's format (one
// query; the same eraRecord the schedule page uses).
export async function getBruinsSeasonLines(cupSeasons: Set<string>): Promise<SeasonLine[]> {
  const { rows } = await pool.query(
    `select g.season, g.game_type,
            case when g.home_team_id = $1 then g.home_score else g.away_score end as team,
            case when g.home_team_id = $1 then g.away_score else g.home_score end as opp,
            g.final_state,
            exists (select 1 from nhl_goal_events e where e.game_id = g.id and e.period_type = 'OT' and e.empty_net) as ot_empty_net
     from nhl_games g where (g.home_team_id = $1 or g.away_team_id = $1) and g.game_type in ('regular', 'playoff')`,
    [BOS_TEAM_ID],
  );
  const bySeason = new Map<string, { reg: { team: number; opp: number; finalState: string; otEmptyNet: boolean }[]; playoffs: boolean }>();
  for (const r of rows) {
    const e = bySeason.get(r.season) ?? { reg: [], playoffs: false };
    if (r.game_type === "regular") e.reg.push({ team: r.team, opp: r.opp, finalState: r.final_state, otEmptyNet: r.ot_empty_net });
    else e.playoffs = true;
    bySeason.set(r.season, e);
  }
  return [...bySeason.entries()]
    .map(([seasonId, e]) => ({ seasonId, record: eraRecord(seasonId, e.reg), games: e.reg.length, cup: cupSeasons.has(seasonId), playoffs: e.playoffs }))
    .sort((a, b) => b.seasonId.localeCompare(a.seasonId));
}
