// Loads games whose player stats count though the game doesn't (see
// db/migrations/0031_stats_only_games.sql): the 1988 Final's suspended
// Game 4. No box score exists for it; the NHL's stats service has every
// player's line. Checks each team's goals add up to the 3-3 score and that
// both goalies are there before writing. Idempotent.
//
// Usage: npx tsx --env-file=.env.local scripts/stats/load-stats-only-games.ts

import { Client } from "pg";

/* eslint-disable @typescript-eslint/no-explicit-any -- the NHL feed is untyped JSON */
const GAMES = [
  {
    id: 1987030999,
    season: "19871988",
    gameType: "playoff",
    date: "1988-05-24",
    home: "BOS", // Boston Garden (the stats service marks Edmonton home; the game was in Boston)
    away: "EDM",
    homeScore: 3,
    awayScore: 3,
    note: "1988 Final Game 4, suspended at 3-3 at 16:37 of the second period when Boston Garden lost power; player stats count, the game doesn't (replayed in Edmonton)",
    sameTeamsAs: 1987030413, // Game 3, for the season's team ids
  },
];

async function get(kind: "skater" | "goalie", gameId: number): Promise<any[]> {
  const url = `https://api.nhle.com/stats/rest/en/${kind}/summary?isAggregate=false&isGame=true&limit=-1&cayenneExp=${encodeURIComponent(`gameId=${gameId}`)}`;
  for (let i = 0; i < 6; i++) {
    const res = await fetch(url).catch(() => null);
    if (res?.ok) return (await res.json()).data;
    await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
  }
  throw new Error(`failed: ${url}`);
}

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  for (const g of GAMES) {
    const { rows: [ref] } = await db.query(
      `select g.home_team_id, h.tri_code home, g.away_team_id, a.tri_code away from nhl_games g
       join nhl_teams h on h.id = g.home_team_id join nhl_teams a on a.id = g.away_team_id where g.id = $1`,
      [g.sameTeamsAs],
    );
    const teamId = new Map<string, number>([[ref.home, ref.home_team_id], [ref.away, ref.away_team_id]]);
    if (!teamId.has(g.home) || !teamId.has(g.away)) throw new Error(`${g.id}: teams don't match game ${g.sameTeamsAs}`);
    const [skaters, goalies] = [await get("skater", g.id), await get("goalie", g.id)];
    const goalsFor = (abbrev: string) => skaters.filter((s) => s.teamAbbrev === abbrev).reduce((n, s) => n + s.goals, 0);
    if (goalsFor(g.home) !== g.homeScore || goalsFor(g.away) !== g.awayScore) throw new Error(`${g.id}: goals ${goalsFor(g.home)}-${goalsFor(g.away)} don't make the ${g.homeScore}-${g.awayScore} score`);
    if (new Set(goalies.map((x) => x.teamAbbrev)).size !== 2) throw new Error(`${g.id}: expected a goalie for each team`);
    const unknown = [...skaters, ...goalies].filter((p) => !teamId.has(p.teamAbbrev));
    if (unknown.length) throw new Error(`${g.id}: players on other teams: ${unknown.map((p) => p.playerId)}`);

    await db.query("begin");
    await db.query(
      `insert into nhl_stats_only_games (id, season, game_type, game_date, home_team_id, away_team_id, home_score, away_score, note)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (id) do update set season = excluded.season, game_type = excluded.game_type, game_date = excluded.game_date, home_team_id = excluded.home_team_id,
         away_team_id = excluded.away_team_id, home_score = excluded.home_score, away_score = excluded.away_score, note = excluded.note`,
      [g.id, g.season, g.gameType, g.date, teamId.get(g.home), teamId.get(g.away), g.homeScore, g.awayScore, g.note],
    );
    await db.query(`delete from nhl_skater_games where game_id = $1`, [g.id]);
    await db.query(`delete from nhl_goalie_games where game_id = $1`, [g.id]);
    for (const s of skaters)
      await db.query(
        `insert into nhl_skater_games (game_id, player_id, team_id, position, goals, assists, pim, sog, plus_minus, played)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)`,
        [g.id, s.playerId, teamId.get(s.teamAbbrev), s.positionCode ?? null, s.goals, s.assists, s.penaltyMinutes ?? 0, s.shots ?? null, s.plusMinus ?? null],
      );
    for (const x of goalies) {
      const decision = x.wins ? "W" : x.losses ? "L" : x.otLosses ? "OTL" : x.ties ? "T" : null;
      await db.query(
        `insert into nhl_goalie_games (game_id, player_id, team_id, started, decision, toi_sec, shots_against, saves, goals_against)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [g.id, x.playerId, teamId.get(x.teamAbbrev), x.gamesStarted === 1, decision, x.timeOnIce ?? null, x.shotsAgainst ?? null, x.saves ?? null, x.goalsAgainst ?? null],
      );
    }
    await db.query("commit");
    console.log(`${g.id}: ${skaters.length} skaters, ${goalies.length} goalies (${g.home} ${g.homeScore}, ${g.away} ${g.awayScore}).`);
  }
  await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
