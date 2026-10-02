import { pool } from "./db";
import { BOS_TEAM_ID, roundName, playoffParts } from "./history-data";

// "This day in Bruins history": the Bruins' games on today's date (Eastern)
// in past seasons. Every fact is computed from verified data, nothing
// generated: the iconic games' curated label and story, the stage (season
// opener, playoff round and game), overtime, a shutout from the final
// score, and player feats (hat tricks, 4+ point games) only from box
// scores that passed their checks (nhl_box_checks for games before
// 2007-08, the site's own box scores after). Dates with no Bruins game
// (most of July and August) return nothing.

export type ThisDayGame = {
  id: number;
  date: string;
  yearsAgo: number;
  opponent: string;
  isHome: boolean;
  team: number;
  opp: number;
  finalState: string;
  otPeriods: number;
  headline: string;
  story: string | null;
  facts: string[];
  rank: number;
};

const SITE_FROM = "20072008";

export async function getThisDay(today: Date): Promise<ThisDayGame[]> {
  const et = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(today); // YYYY-MM-DD
  const [year, mm, dd] = et.split("-");
  const { rows } = await pool.query(
    `select g.id, g.season, g.game_type, g.game_date::text as date, g.home_team_id = $1 as is_home,
            case when g.home_team_id = $1 then at.tri_code else ht.tri_code end as opponent,
            case when g.home_team_id = $1 then at.full_name else ht.full_name end as opponent_name,
            case when g.home_team_id = $1 then g.home_score else g.away_score end as team,
            case when g.home_team_id = $1 then g.away_score else g.home_score end as opp,
            g.final_state, coalesce(g.ot_periods, 0) as ot_periods,
            i.label as iconic_label, i.short_story, coalesce(i.fame_weight, 0) as fame_weight, coalesce(i.featurable, false) as featurable,
            (select l.label from game_labels l where l.game_id = g.id order by l.fame_points desc limit 1) as label,
            coalesce((select max(l.fame_points) from game_labels l where l.game_id = g.id), 0) as fame_points,
            (select max((x.id / 100) % 10) from nhl_games x where x.season = g.season and x.game_type = 'playoff') as max_round,
            g.id = (select min(o.id) from nhl_games o where o.season = g.season and o.game_type = 'regular' and $1 in (o.home_team_id, o.away_team_id)) as opener
     from nhl_games g
     join nhl_teams ht on ht.id = g.home_team_id join nhl_teams at on at.id = g.away_team_id
     left join iconic_games i on i.game_id = g.id
     where to_char(g.game_date, 'MM-DD') = $2 and $1 in (g.home_team_id, g.away_team_id) and g.game_date < $3::date
       and g.game_type in ('regular', 'playoff')`,
    [BOS_TEAM_ID, `${mm}-${dd}`, et],
  );
  const out: ThisDayGame[] = [];
  for (const r of rows) {
    const facts: string[] = [];
    if (r.game_type === "playoff") {
      const p = playoffParts(Number(r.id));
      facts.push(`${roundName(r.season, p.round, Number(r.max_round ?? p.round), p.series)}, Game ${p.game}`);
    } else if (r.opener) facts.push("Season opener");
    if (r.final_state === "OT") facts.push(r.ot_periods > 1 ? `${r.ot_periods} overtimes` : "Overtime");
    if (r.final_state === "SO") facts.push("Shootout");
    if (r.opp === 0 && r.team > 0) facts.push("Bruins shutout");
    facts.push(...(await feats(Number(r.id), r.season)));
    const won = r.team > r.opp, tied = r.team === r.opp;
    const generated = tied ? `Bruins and ${r.opponent_name} tie, ${r.team}-${r.opp}` : won ? `Bruins beat the ${r.opponent_name}, ${r.team}-${r.opp}` : `${r.opponent_name} beat the Bruins, ${r.opp}-${r.team}`;
    const featured = r.featurable && r.iconic_label;
    out.push({
      id: Number(r.id),
      date: r.date,
      yearsAgo: Number(year) - Number(r.date.slice(0, 4)),
      opponent: r.opponent,
      isHome: r.is_home,
      team: r.team,
      opp: r.opp,
      finalState: r.final_state,
      otPeriods: r.ot_periods,
      // Labels (game_labels) rank games but read like data lines, so the
      // headline is the curated iconic label or the result itself.
      headline: featured ? r.iconic_label : generated,
      story: featured ? r.short_story : null,
      facts,
      // Iconic first, then labeled games, playoff games, games with a feat.
      rank: (featured ? 1000 + Number(r.fame_weight) : 0) + Number(r.fame_points) * 10 + (r.game_type === "playoff" ? 50 : 0) + facts.length * 5 + (won ? 2 : 0),
    });
  }
  return out.sort((a, b) => b.rank - a.rank || b.date.localeCompare(a.date));
}

// Bruins hat tricks and 4+ point games, from verified box scores only.
async function feats(gameId: number, season: string): Promise<string[]> {
  const rows =
    season >= SITE_FROM
      ? (
          await pool.query(
            `select p.full_name as name, s.goals, s.assists from skater_game_stats s join players p on p.id = s.player_id
             join teams t on t.id = s.team_id where s.game_id = $1 and t.abbrev = 'BOS' and (s.goals >= 3 or s.goals + s.assists >= 4)`,
            [gameId],
          )
        ).rows
      : (
          await pool.query(
            `select coalesce(p.full_name, '') as name, s.goals, s.assists from nhl_skater_games s
             join nhl_box_checks c on c.game_id = s.game_id and c.ok left join nhl_players p on p.id = s.player_id
             where s.game_id = $1 and s.team_id = $2 and s.played and (s.goals >= 3 or s.goals + s.assists >= 4)`,
            [gameId, BOS_TEAM_ID],
          )
        ).rows;
  return rows
    .filter((r) => r.name)
    .map((r) => (r.goals >= 3 ? `${r.name}: ${r.goals === 3 ? "hat trick" : `${r.goals} goals`}${r.assists ? `, ${r.assists} ${r.assists === 1 ? "assist" : "assists"}` : ""}` : `${r.name}: ${r.goals + r.assists} points (${r.goals} G, ${r.assists} A)`));
}
