// A verified fact sheet for one game, built entirely from the database —
// the only material the recap narrator (lib/narrate-recap.ts) is allowed to
// write from. The recap once saw nothing but the final score, so it either
// said nothing real (a 4-goal, 6-assist night became "the Bruins put on a
// show") or inferred things it couldn't know ("Buffalo dominated", "home
// opener"). Every line here is a direct read of stored data; anything the
// data can't support — period-by-period flow, who scored first, the game-
// winner — is deliberately absent (no play-by-play is loaded), and the
// narrator's validators reject claims about it.

import type { Client } from "pg";

export type GameFacts = {
  lines: string[];
  text: string; // lines joined, for validators
  properNames: string[]; // team names, arena, and every player on the sheet — for capitalization repair
  homeAbbrev: string;
  awayAbbrev: string;
  homeScore: number;
  awayScore: number;
  gameDate: string;
  gameType: string;
  endType: string;
  hasTeamStats: boolean;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ROUNDS: Record<number, string> = { 1: "First Round", 2: "Second Round", 3: "Conference Final", 4: "Stanley Cup Final" };

// "BOS outshot TBL 33 to 23 (a large edge)" — leader first, with the size
// of the gap stated, so the narrator neither judges closeness itself (a
// trial recap called 28-18 "close") nor gets the direction backwards (one
// wrote that Boston "dominated expected goals 2.46 to 3.54").
function leaderFirst(away: number, home: number, awayAbbrev: string, homeAbbrev: string, verb: string, digits: number): string {
  const f = (v: number) => v.toFixed(digits);
  if (away === home) return `${awayAbbrev} and ${homeAbbrev} were even at ${f(home)} each`;
  const [lead, trail, leadV, trailV] = home > away ? [homeAbbrev, awayAbbrev, home, away] : [awayAbbrev, homeAbbrev, away, home];
  const share = leadV / (leadV + trailV);
  const size = share >= 0.6 ? "a large edge" : share >= 0.55 ? "a clear edge" : "a slight edge";
  // The difference is on the sheet too ("by 11") — a recap that said
  // "outshot by 11" was rejected because 11 appeared nowhere.
  return `${lead} ${verb} ${trail}, ${f(leadV)} to ${f(trailV)} (by ${f(leadV - trailV)}, ${size})`;
}

const seasonLabel = (id: string) => `${id.slice(0, 4)}-${id.slice(6, 8)}`;

// Stored dates are UTC midnight of the local game date — read with UTC
// getters, never local ones (see lib/format-date.ts).
function longDate(d: Date) {
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export async function buildGameFacts(client: Client, gameId: number, targetAbbrev: string): Promise<GameFacts | null> {
  const { rows: gameRows } = await client.query(
    `select g.*, ht.abbrev as home_abbrev, at.abbrev as away_abbrev, ht.name as home_name, at.name as away_name
     from games g join teams ht on ht.id = g.home_team_id join teams at on at.id = g.away_team_id
     where g.id = $1`,
    [gameId],
  );
  const g = gameRows[0];
  if (!g) return null;
  // Only for games the target team played — every line below is written
  // from its side (a trial on a Buffalo-Utah game produced "the Bruins fall
  // to 0-2 vs Utah").
  if (g.home_abbrev !== targetAbbrev && g.away_abbrev !== targetAbbrev) return null;
  const targetIsHome = g.home_abbrev === targetAbbrev;
  const targetId = targetIsHome ? g.home_team_id : g.away_team_id;
  const oppAbbrev = targetIsHome ? g.away_abbrev : g.home_abbrev;
  const lines: string[] = [];

  const endNote = g.game_end_type === "overtime" ? " in overtime" : g.game_end_type === "shootout" ? " in a shootout" : "";
  lines.push(
    `Final${endNote}: ${g.away_name} (${g.away_abbrev}) ${g.away_score}, ${g.home_name} (${g.home_abbrev}) ${g.home_score}. Played ${longDate(g.game_date)} at ${g.venue}, ${g.home_abbrev}'s home arena. ${targetAbbrev} was the ${targetIsHome ? "home" : "away"} team.`,
  );

  // Where this game sits in the season — stated only when it's knowable.
  if (g.game_type === "regular") {
    const { rows } = await client.query(
      `select count(*)::int as n, count(*) filter (where home_team_id = $1)::int as home_n
       from games where season_id = $2 and game_type = 'regular' and (home_team_id = $1 or away_team_id = $1) and game_date <= $3`,
      [targetId, g.season_id, g.game_date],
    );
    const { n, home_n } = rows[0];
    // "Final regular-season game" only when the data proves it: no later
    // regular-season game for this team that season, and the season has
    // moved on (playoffs or a later season exist). Never inferred from the
    // game number — seasons were 82 games through 2025-26 and 84 after.
    const { rows: fin } = await client.query(
      `select not exists (select 1 from games where season_id = $1 and game_type = 'regular'
                            and (home_team_id = $2 or away_team_id = $2) and game_date > $3)
              and exists (select 1 from games where (season_id = $1 and game_type = 'playoff') or season_id > $1) as is_last`,
      [g.season_id, targetId, g.game_date],
    );
    const tag =
      n === 1
        ? ` — its season opener`
        : fin[0].is_last
          ? ` — its final regular-season game`
          : targetIsHome && home_n === 1
            ? ` — its home opener`
            : "";
    lines.push(`This was ${targetAbbrev}'s game ${n} of the ${seasonLabel(String(g.season_id))} regular season${tag}.`);

    // The team's own record after this game. Without it on the sheet, a
    // trial recap repurposed the season-series record ("improve to 1-0-0
    // on the young season" — that was the series vs NSH; Boston was 2-0-0).
    const { rows: rec } = await client.query(
      `select count(*) filter (where (home_team_id = $1 and home_score > away_score) or (away_team_id = $1 and away_score > home_score))::int as w,
              count(*) filter (where ((home_team_id = $1 and home_score < away_score) or (away_team_id = $1 and away_score < home_score)) and game_end_type = 'regulation')::int as l,
              count(*) filter (where ((home_team_id = $1 and home_score < away_score) or (away_team_id = $1 and away_score < home_score)) and game_end_type <> 'regulation')::int as otl
       from games where season_id = $2 and game_type = 'regular' and (home_team_id = $1 or away_team_id = $1) and game_date <= $3`,
      [targetId, g.season_id, g.game_date],
    );
    lines.push(`${targetAbbrev}'s season record after this game: ${rec[0].w}-${rec[0].l}-${rec[0].otl}.`);

    const { rows: h2h } = await client.query(
      `select count(*) filter (where (home_team_id = $1 and home_score > away_score) or (away_team_id = $1 and away_score > home_score))::int as w,
              count(*) filter (where ((home_team_id = $1 and home_score < away_score) or (away_team_id = $1 and away_score < home_score)) and game_end_type = 'regulation')::int as l,
              count(*) filter (where ((home_team_id = $1 and home_score < away_score) or (away_team_id = $1 and away_score < home_score)) and game_end_type <> 'regulation')::int as otl,
              count(*)::int as games
       from games where season_id = $2 and game_type = 'regular' and game_date <= $3
         and ((home_team_id = $1 and away_team_id = $4) or (away_team_id = $1 and home_team_id = $4))`,
      [targetId, g.season_id, g.game_date, targetIsHome ? g.away_team_id : g.home_team_id],
    );
    const s = h2h[0];
    lines.push(`Season series vs ${oppAbbrev} after this game (${s.games} meeting${s.games === 1 ? "" : "s"} so far this season): ${targetAbbrev} ${s.w}-${s.l}-${s.otl}.`);
  } else if (g.game_type === "playoff" && g.series_id) {
    const { rows: series } = await client.query(
      `select ps.round, g2.series_game_number,
              (case when g2.home_team_id = $2 then g2.home_score > g2.away_score else g2.away_score > g2.home_score end) as target_won
       from games g2 join playoff_series ps on ps.id = g2.series_id
       where g2.series_id = $1 and g2.series_game_number <= $3 order by g2.series_game_number`,
      [g.series_id, targetId, g.series_game_number],
    );
    const w = series.filter((r) => r.target_won).length;
    const l = series.length - w;
    const round = ROUNDS[series[0]?.round] ?? `Round ${series[0]?.round}`;
    const state =
      w === 4 ? `${targetAbbrev} won the series ${w}-${l}` : l === 4 ? `${oppAbbrev} won the series ${l}-${w}, eliminating ${targetAbbrev}` : w === l ? `the series is tied ${w}-${l}` : `${w > l ? targetAbbrev : oppAbbrev} leads the series ${Math.max(w, l)}-${Math.min(w, l)}`;
    lines.push(`Playoffs, ${round}, Game ${g.series_game_number} vs ${oppAbbrev}. After this game, ${state}.`);
  }

  // Scoring and standout lines, both teams.
  const { rows: skaters } = await client.query(
    `select t.abbrev, p.full_name, s.goals, s.assists, s.goals + s.assists as points
     from skater_game_stats s join players p on p.id = s.player_id join teams t on t.id = s.team_id
     where s.game_id = $1 and (s.goals > 0 or s.assists > 0)
     order by s.goals desc, s.assists desc`,
    [gameId],
  );
  for (const abbrev of [g.away_abbrev, g.home_abbrev]) {
    const scorers = skaters.filter((r) => r.abbrev === abbrev && r.goals > 0);
    lines.push(
      scorers.length
        ? `${abbrev} goal scorers: ${scorers.map((r) => `${r.full_name} (${r.goals})`).join(", ")}. The order the goals were scored in is not known.`
        : `${abbrev} did not score.`,
    );
    const multi = skaters.filter((r) => r.abbrev === abbrev && r.points >= 2).slice(0, 5);
    if (multi.length) lines.push(`${abbrev} multi-point games: ${multi.map((r) => `${r.full_name} ${r.goals} G, ${r.assists} A`).join("; ")}.`);
  }

  // Goalies — including who was pulled, which a score alone can't show.
  const { rows: goalies } = await client.query(
    `select t.abbrev, p.full_name, gs.saves, gs.shots_against, gs.decision, gs.toi_seconds, gs.shutout,
            count(*) over (partition by gs.team_id) as goalies_used
     from goalie_game_stats gs join players p on p.id = gs.player_id join teams t on t.id = gs.team_id
     where gs.game_id = $1 order by gs.toi_seconds desc`,
    [gameId],
  );
  for (const abbrev of [g.away_abbrev, g.home_abbrev]) {
    const gs = goalies.filter((r) => r.abbrev === abbrev);
    if (!gs.length) continue;
    const describe = (r: (typeof gs)[number]) => {
      const mins = `${Math.floor(r.toi_seconds / 60)}:${String(r.toi_seconds % 60).padStart(2, "0")}`;
      const dec = r.decision ? `, ${r.decision === "W" ? "win" : r.decision === "OTL" ? "overtime/shootout loss" : "loss"}` : ", no decision";
      return `${r.full_name} made ${r.saves} saves on ${r.shots_against} shots in ${mins}${dec}${r.shutout ? ", shutout" : ""}`;
    };
    lines.push(`${abbrev} goaltending: ${gs.map(describe).join("; ")}${gs.length > 1 ? ` (${abbrev} changed goalies during the game)` : ""}.`);
  }

  // Team totals, only the groups actually loaded for this game.
  const { rows: team } = await client.query(
    `select t.abbrev, tgs.shots_on_goal, tgs.pp_goals, tgs.pp_opportunities, tgs.xg_for
     from team_game_stats tgs join teams t on t.id = tgs.team_id where tgs.game_id = $1`,
    [gameId],
  );
  const A = team.find((r) => r.abbrev === g.away_abbrev);
  const H = team.find((r) => r.abbrev === g.home_abbrev);
  let hasTeamStats = false;
  if (A && H) {
    if (A.shots_on_goal != null && H.shots_on_goal != null) {
      hasTeamStats = true;
      lines.push(`Shots on goal: ${leaderFirst(A.shots_on_goal, H.shots_on_goal, g.away_abbrev, g.home_abbrev, "outshot", 0)}.`);
      lines.push(`Power play: ${g.away_abbrev} ${A.pp_goals} for ${A.pp_opportunities}, ${g.home_abbrev} ${H.pp_goals} for ${H.pp_opportunities}.`);
    }
    if (A.xg_for != null && H.xg_for != null) {
      hasTeamStats = true;
      lines.push(`Expected goals (MoneyPuck): ${leaderFirst(Number(A.xg_for), Number(H.xg_for), g.away_abbrev, g.home_abbrev, "had more expected goals than", 2)}.`);
    }
  }

  const properNames = [g.home_name, g.away_name, g.venue, ...skaters.map((r) => r.full_name), ...goalies.map((r) => r.full_name)].filter(Boolean);
  return {
    lines,
    text: lines.join("\n"),
    properNames,
    homeAbbrev: g.home_abbrev,
    awayAbbrev: g.away_abbrev,
    homeScore: g.home_score,
    awayScore: g.away_score,
    gameDate: g.game_date.toISOString().slice(0, 10),
    gameType: g.game_type,
    endType: g.game_end_type,
    hasTeamStats,
  };
}
