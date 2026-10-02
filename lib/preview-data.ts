// Everything a pre-game preview shows, for a game that hasn't been played
// yet (so isn't in our database). Deterministic — no model involved: the
// NHL's game-center feed supplies the matchup, time, venue, TV, and each
// team's CURRENT roster; our own database supplies every number (the same
// verified stats the rest of the site uses), labeled with the season it
// comes from.

import { pool } from "./db";
import { nhlJson } from "./nhl-fetch";
import { getLeagueComparisonSeason, getLeagueTeamStats, rankTeam, type LeagueTeamStats } from "./league-data";
import { getUpcomingMilestones, type Milestone } from "./milestones-data";
import { getClubSeason, openerTag } from "./nhl-schedule";

const API = "https://api-web.nhle.com/v1";

export type PreviewTeam = {
  abbrev: string;
  id: number | null;
  name: string; // "Bruins"
  fullName: string; // "Boston Bruins"
  score: number | null; // live/final only
  stats: { label: string; value: string; rank: string | null }[];
  form: ("W" | "L" | "OT")[]; // last 5 regular-season games, reference season
  goalies: { id: number; name: string; line: string | null }[];
  topSkaters: { id: number; name: string; line: string }[];
  milestonesTonight: Milestone[];
  streaks: { id: number; name: string; games: number }[];
};

export type Preview = {
  id: number;
  season: string;
  gameType: number;
  state: string; // FUT, PRE, LIVE, CRIT, FINAL, OFF
  startTimeUTC: string;
  venue: string;
  tv: string[];
  away: PreviewTeam;
  home: PreviewTeam;
  statsSeasonLabel: string;
  tag: string | null; // "Opening Night" / "Home Opener", from the home team's schedule
  meetings: { id: number; date: Date; gameType: string; awayAbbrev: string; homeAbbrev: string; awayScore: number; homeScore: number; endType: string }[];
};

const seasonLabel = (id: string) => `${id.slice(0, 4)}-${id.slice(6, 8)}`;
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

type ApiTeam = { id: number; abbrev: string; commonName?: { default: string }; placeName?: { default: string }; score?: number };

export async function getPreview(gameId: number): Promise<Preview | null> {
  // null = the NHL says there's no such game (a real 404); an outage throws
  // (lib/nhl-fetch.ts) so the page shows "try again", never a false 404.
  const landing = await nhlJson<Record<string, any>>(`${API}/gamecenter/${gameId}/landing`, 300); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!landing?.homeTeam || (landing.gameType !== 2 && landing.gameType !== 3)) return null;

  const season = String(landing.season);
  const [awayApi, homeApi] = [landing.awayTeam as ApiTeam, landing.homeTeam as ApiTeam];
  const { rows: teamRows } = await pool.query(`select id, abbrev, name from teams where is_active and abbrev = any($1)`, [[awayApi.abbrev, homeApi.abbrev]]);
  const dbTeam = (abbrev: string) => teamRows.find((r) => r.abbrev === abbrev);

  // Team numbers come from the league comparison's season rule: this season
  // once every team has played, otherwise last season's final numbers —
  // labeled either way.
  const { seasonId: statsSeason, pending } = await getLeagueComparisonSeason();
  const league = statsSeason ? await getLeagueTeamStats(statsSeason) : [];
  const statsSeasonLabel = statsSeason ? `${seasonLabel(statsSeason)}${pending || statsSeason !== season ? " final" : " so far"}` : "";

  const tv = (landing.tvBroadcasts ?? [])
    .filter((b: { market: string }) => b.market === "N" || b.market === "H" || b.market === "A")
    .map((b: { network: string; market: string; countryCode: string }) =>
      b.market === "N" ? `${b.network}${b.countryCode === "CA" ? " (CAN)" : ""}` : `${b.network} (${b.market === "H" ? homeApi.abbrev : awayApi.abbrev})`,
    );

  const [away, home] = await Promise.all([
    buildTeam(awayApi, dbTeam(awayApi.abbrev), league, statsSeason, season),
    buildTeam(homeApi, dbTeam(homeApi.abbrev), league, statsSeason, season),
  ]);

  // Last five meetings, any season, regular or playoff.
  const { rows: meetings } = away.id && home.id
    ? await pool.query(
        `select g.id, g.game_date as date, g.game_type as "gameType", at.abbrev as "awayAbbrev", ht.abbrev as "homeAbbrev",
                g.away_score as "awayScore", g.home_score as "homeScore", g.game_end_type as "endType"
         from games g join teams ht on ht.id = g.home_team_id join teams at on at.id = g.away_team_id
         where g.game_type in ('regular', 'playoff')
           and ((g.home_team_id = $1 and g.away_team_id = $2) or (g.home_team_id = $2 and g.away_team_id = $1))
         order by g.game_date desc limit 5`,
        [away.id, home.id],
      )
    : { rows: [] };

  const homeClub = await getClubSeason(homeApi.abbrev);
  const clubGame = homeClub?.games.find((g) => g.id === gameId);
  const tag = homeClub && clubGame ? openerTag(homeClub, clubGame) : null;

  return {
    id: gameId,
    tag,
    season,
    gameType: landing.gameType,
    state: landing.gameState,
    startTimeUTC: landing.startTimeUTC,
    venue: landing.venue?.default ?? "",
    tv: [...new Set(tv as string[])],
    away,
    home,
    statsSeasonLabel,
    meetings,
  };
}

async function buildTeam(
  api: ApiTeam,
  db: { id: number; abbrev: string; name: string } | undefined,
  league: LeagueTeamStats[],
  statsSeason: string | null,
  season: string,
): Promise<PreviewTeam> {
  const own = league.find((t) => t.abbrev === api.abbrev);
  const rank = (metric: (t: LeagueTeamStats) => number | null, higherIsBetter: boolean) => {
    const r = rankTeam(league, api.abbrev, metric, higherIsBetter);
    return r ? `${ordinal(r.rank)} of ${r.outOf}` : null;
  };
  const specialTeams = (own?.specialTeamsCoverage ?? 0) >= 0.99;
  const stats = own
    ? [
        { label: "Points %", value: pct(own.pointsPct), rank: rank((t) => t.pointsPct, true) },
        { label: "Goals for / game", value: own.goalsForPerGame.toFixed(2), rank: rank((t) => t.goalsForPerGame, true) },
        { label: "Goals against / game", value: own.goalsAgainstPerGame.toFixed(2), rank: rank((t) => t.goalsAgainstPerGame, false) },
        ...(specialTeams
          ? [
              { label: "Power play", value: pct(own.ppPct), rank: rank((t) => t.ppPct, true) },
              { label: "Penalty kill", value: pct(own.pkPct), rank: rank((t) => t.pkPct, true) },
            ]
          : []),
      ]
    : [];

  // Form: last five regular-season results in the stats season.
  const form: PreviewTeam["form"] = [];
  if (db && statsSeason) {
    const { rows } = await pool.query(
      `select case when home_team_id = $1 then home_score else away_score end as us,
              case when home_team_id = $1 then away_score else home_score end as them, game_end_type
       from games where (home_team_id = $1 or away_team_id = $1) and season_id = $2 and game_type = 'regular'
       order by game_date desc limit 5`,
      [db.id, statsSeason],
    );
    for (const r of rows.reverse()) form.push(r.us > r.them ? "W" : r.game_end_type === "regulation" ? "L" : "OT");
  }

  // Current roster (NHL), with each player's most recent regular season on
  // file — for any team, so an offseason arrival shows last year's line.
  let roster: { id: number; name: string; pos: string }[] = [];
  try {
    const d = await nhlJson<Record<string, any>>(`${API}/roster/${api.abbrev}/current`, 3600); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (d) {
      roster = [...(d.forwards ?? []), ...(d.defensemen ?? []), ...(d.goalies ?? [])].map(
        (p: { id: number; firstName: { default: string }; lastName: { default: string }; positionCode: string }) => ({
          id: p.id,
          name: `${p.firstName.default} ${p.lastName.default}`,
          pos: p.positionCode,
        }),
      );
    }
  } catch {
    // no roster — the goalie and skater sections simply don't render
  }
  const goalieIds = roster.filter((p) => p.pos === "G").map((p) => p.id);
  const skaterIds = roster.filter((p) => p.pos !== "G").map((p) => p.id);

  const { rows: goalieRows } = goalieIds.length
    ? await pool.query(
        `with latest as (
           select distinct on (s.player_id) s.player_id, g.season_id
           from goalie_game_stats s join games g on g.id = s.game_id
           where s.player_id = any($1::int[]) and g.game_type = 'regular'
           order by s.player_id, g.game_date desc)
         select l.player_id, l.season_id, count(*)::int as gp,
                count(*) filter (where s.decision = 'W')::int as w, count(*) filter (where s.decision = 'L')::int as l,
                count(*) filter (where s.decision = 'OTL')::int as otl, count(*) filter (where s.shutout)::int as so,
                sum(s.saves)::float / nullif(sum(s.shots_against), 0) as sv,
                sum(s.goals_against)::float * 3600 / nullif(sum(s.toi_seconds), 0) as gaa,
                (array_agg(t.abbrev order by g.game_date desc))[1] as last_team
         from latest l join goalie_game_stats s on s.player_id = l.player_id
         join games g on g.id = s.game_id and g.season_id = l.season_id and g.game_type = 'regular'
         join teams t on t.id = s.team_id
         group by l.player_id, l.season_id`,
        [goalieIds],
      )
    : { rows: [] };
  const goalies = roster
    .filter((p) => p.pos === "G")
    .map((p) => {
      const r = goalieRows.find((x) => Number(x.player_id) === p.id);
      return {
        id: p.id,
        name: p.name,
        line: r
          ? `${seasonLabel(String(r.season_id))}${r.last_team !== api.abbrev ? ` with ${r.last_team}` : ""}: ${r.gp} GP, ${r.w}-${r.l}-${r.otl}, ${r.sv != null ? r.sv.toFixed(3).replace(/^0/, "") : "—"} SV%, ${r.gaa != null ? r.gaa.toFixed(2) : "—"} GAA, ${r.so} SO`
          : null,
      };
    })
    // Most games played first — the likelier starter leads.
    .sort((a, b) => (goalieRows.find((x) => Number(x.player_id) === b.id)?.gp ?? -1) - (goalieRows.find((x) => Number(x.player_id) === a.id)?.gp ?? -1));

  const { rows: skaterRows } = skaterIds.length
    ? await pool.query(
        `with latest as (
           select distinct on (s.player_id) s.player_id, g.season_id
           from skater_game_stats s join games g on g.id = s.game_id
           where s.player_id = any($1::int[]) and g.game_type = 'regular'
           order by s.player_id, g.game_date desc)
         select l.player_id, l.season_id, count(*)::int as gp, sum(s.goals)::int as g, sum(s.assists)::int as a,
                sum(s.goals + s.assists)::int as p,
                (array_agg(t.abbrev order by g.game_date desc))[1] as last_team
         from latest l join skater_game_stats s on s.player_id = l.player_id
         join games g on g.id = s.game_id and g.season_id = l.season_id and g.game_type = 'regular'
         join teams t on t.id = s.team_id
         group by l.player_id, l.season_id
         order by p desc limit 3`,
        [skaterIds],
      )
    : { rows: [] };
  const topSkaters = skaterRows.map((r) => ({
    id: Number(r.player_id),
    name: roster.find((p) => p.id === Number(r.player_id))?.name ?? "",
    line: `${r.g} G, ${r.a} A, ${r.p} P in ${r.gp} GP (${seasonLabel(String(r.season_id))}${r.last_team !== api.abbrev ? `, with ${r.last_team}` : ""})`,
  }));

  // Within reach tonight: a single game's worth of each stat.
  const milestonesTonight = db
    ? (await getUpcomingMilestones(api.abbrev, statsSeason ?? season)).filter((m) =>
        m.category === "career goals" ? m.remaining <= 2 : m.category === "career points" ? m.remaining <= 3 : m.remaining <= 1,
      )
    : [];

  // Active point streaks (3+) entering tonight, this season only.
  const streaks: PreviewTeam["streaks"] = [];
  if (db && skaterIds.length) {
    const { rows } = await pool.query(
      `select s.player_id, p.full_name, array_agg(s.goals + s.assists > 0 order by g.game_date desc) as scored
       from skater_game_stats s join games g on g.id = s.game_id join players p on p.id = s.player_id
       where s.team_id = $1 and g.season_id = $2 and g.game_type = 'regular' and s.player_id = any($3::int[])
       group by s.player_id, p.full_name`,
      [db.id, season, skaterIds],
    );
    for (const r of rows) {
      let n = 0;
      for (const hit of r.scored as boolean[]) {
        if (!hit) break;
        n++;
      }
      if (n >= 3) streaks.push({ id: Number(r.player_id), name: r.full_name, games: n });
    }
    streaks.sort((a, b) => b.games - a.games);
  }

  return {
    abbrev: api.abbrev,
    id: db?.id ?? null,
    name: api.commonName?.default ?? api.abbrev,
    fullName: db?.name ?? api.abbrev,
    score: api.score ?? null,
    stats,
    form,
    goalies,
    topSkaters,
    milestonesTonight,
    streaks,
  };
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
