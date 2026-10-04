// One finished game's rows for the site's tables (games, skater_game_stats,
// goalie_game_stats) from the NHL's box score, and the upserts that write
// them. Shared by the hourly loader (scripts/backfill-season.ts) and the
// site's own load-on-final (lib/load-game.ts), so the two can never drift
// apart: every rule below was found the hard way and lives in one place.

/* eslint-disable @typescript-eslint/no-explicit-any -- the NHL feed is untyped JSON */

export type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };

export type GameRows = {
  game: unknown[];
  skaters: unknown[][];
  goalies: unknown[][];
  // Everyone with a row, for the caller's player upserts (which must run
  // first: the stat tables reference players).
  players: { p: any; teamId: number }[];
  // Both teams' goalies came back, so the box score is complete enough to
  // trust its absences (a re-check removes players it no longer lists).
  complete: boolean;
};

export function timeToSeconds(mmss: string | undefined | null): number | null {
  if (!mmss) return null;
  const [m, s] = mmss.split(":").map(Number);
  return m * 60 + s;
}

export function gameEndType(periodType: string | undefined): string {
  if (periodType === "SO") return "shootout";
  if (periodType === "OT") return "overtime";
  return "regulation";
}

// g: the game's header (a schedule entry or the box score itself; both
// carry id, gameDate, startTimeUTC, gameType, gameOutcome, venue and each
// team's id and score). box: the box score.
export function gameRows(seasonId: string, g: any, box: any, series?: { seriesId: number; gameNumber: number }): GameRows {
  const endType = gameEndType(g.gameOutcome?.lastPeriodType);
  const game = [
    g.id,
    seasonId,
    g.gameDate,
    g.startTimeUTC,
    g.gameType === 3 ? "playoff" : "regular",
    endType,
    series?.seriesId ?? null,
    series?.gameNumber ?? null,
    g.homeTeam.id,
    g.awayTeam.id,
    g.homeTeam.score,
    g.awayTeam.score,
    g.venue.default,
    "nhl-api",
  ];
  const skaters: unknown[][] = [];
  const goalies: unknown[][] = [];
  const players: { p: any; teamId: number }[] = [];

  for (const side of ["homeTeam", "awayTeam"] as const) {
    const teamId = side === "homeTeam" ? g.homeTeam.id : g.awayTeam.id;
    const stats = box.playerByGameStats?.[side];
    if (!stats) continue;

    // A skater "played" only with real ice time, like goalies below. A
    // dressed skater who never took a shift is listed with 0:00 and no
    // stats; the NHL doesn't count it as a game played (63 such rows
    // once each added a phantom GP, all checked against the NHL's game
    // logs on 2026-10-01).
    const skated = (p: { toi?: string | null }) => !!p.toi && p.toi !== "00:00";
    for (const p of [...stats.forwards, ...stats.defense]) {
      if (!skated(p)) continue;
      players.push({ p, teamId });
      skaters.push([
        g.id,
        p.playerId,
        teamId,
        p.goals ?? 0,
        p.assists ?? 0,
        p.sog ?? null,
        p.hits ?? null,
        p.blockedShots ?? null,
        p.giveaways ?? null,
        p.takeaways ?? null,
        p.pim ?? null,
        p.plusMinus ?? null,
        p.powerPlayGoals ?? null,
        timeToSeconds(p.toi),
        "nhl-api",
      ]);
    }

    // A shutout is credited only to a goalie who played the whole game
    // alone with the opponent held scoreless in regulation and overtime.
    // The shootout winner counts in the final score but isn't a goal
    // against: a 0-0 game lost in a shootout is still a shutout (the NHL
    // credits it; found 2026-10-02 checking careers against the NHL, 53
    // such games had been missed). Empty-net goals do count against the
    // team, so this uses the team's score, not the goalie's own goals
    // against. Found live: deriving it from the goalie's own
    // goals_against=0 credited 1,178 relief appearances league-wide.
    // A goalie "played" only with real ice time. Older seasons (2007-09)
    // list the dressed backup with toi: null, which once loaded 4,848
    // empty phantom rows and made real one-goalie shutouts look shared.
    const played = (p: { toi?: string | null }) => !!p.toi && p.toi !== "00:00";
    // Except a goalie sent in only for the shootout: 0:00 of ice time, but
    // the NHL charges him the decision and counts the game played (Curtis
    // Joseph, 2008-10-21; found 2026-10-03, those decisions had been pinned
    // on the starter). He doesn't count toward sharing the net for a
    // shutout, which is about the 65 minutes.
    const appeared = (p: { toi?: string | null; decision?: string | null }) => played(p) || !!p.decision;
    const goaliesUsed = stats.goalies.filter(played).length;
    const oppFinal = side === "homeTeam" ? g.awayTeam.score : g.homeTeam.score;
    const ownFinal = side === "homeTeam" ? g.homeTeam.score : g.awayTeam.score;
    const oppScore = endType === "shootout" && oppFinal > ownFinal ? oppFinal - 1 : oppFinal; // less the shootout winner
    for (const p of stats.goalies) {
      if (!appeared(p)) continue; // dressed but didn't play
      players.push({ p, teamId });
      // The API's own codes are authoritative: "O" is an OT/shootout
      // loss, "L" is always a loss. Two real bugs came from deriving it
      // instead: only "L" was recognized, so every regular-season OT loss
      // ("O") became a null decision; and "L" in an OT game was rewritten
      // to OTL, but that's either a playoff OT loss (playoffs have no OTL)
      // or the pulled-goalie-in-OT rule, where the NHL charges a
      // regulation loss (MIN, 2024-03-30). "O" in a playoff game is real
      // too: the 2020 bubble's seeding round-robin used regular-season
      // overtime, and the NHL charges those losses as OTL (Holtby,
      // 2020-08-03); an ordinary playoff OT loss comes through as "L".
      const decision = p.decision === "W" ? "W" : p.decision === "O" ? "OTL" : p.decision === "L" ? "L" : null;
      goalies.push([
        g.id,
        p.playerId,
        teamId,
        decision,
        p.shotsAgainst ?? null,
        p.saves ?? null,
        p.goalsAgainst ?? null,
        p.savePctg ?? null,
        timeToSeconds(p.toi),
        played(p) && goaliesUsed === 1 && oppScore === 0,
        "nhl-api",
      ]);
    }
  }
  const pbs = box.playerByGameStats;
  return { game, skaters, goalies, players, complete: !!(pbs?.homeTeam?.goalies?.length && pbs?.awayTeam?.goalies?.length) };
}

// Builds a single multi-row INSERT so a batch of rows costs one DB round
// trip instead of one per row (the per-row round trip to a remote Neon
// instance was the backfill's measured bottleneck). All values stay bound
// parameters; nothing here is string-interpolated into SQL.
export function buildMultiRowInsert(
  table: string,
  columns: string[],
  rows: unknown[][],
  conflictTarget: string,
  conflictUpdate: string,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const valueRows = rows.map((row) => `(${row.map((v) => `$${params.push(v)}`).join(", ")})`);
  return {
    sql: `insert into ${table} (${columns.join(", ")})
          values ${valueRows.join(", ")}
          on conflict (${conflictTarget}) do update set ${conflictUpdate}`,
    params,
  };
}

// Writes any number of games' rows. Every stat is overwritten, so a
// re-checked game takes the NHL's corrections; for each game in `recheck`
// whose box score was complete, players the NHL no longer lists go. Found
// 2026-10-03: Winnipeg's plus-minus and a Guentzel shot had been corrected
// by the NHL after the night they were loaded.
export async function writeGameRows(db: Queryable, all: GameRows[], recheck: Set<number> = new Set()): Promise<string[]> {
  const notes: string[] = [];
  if (!all.length) return notes;
  const games = buildMultiRowInsert(
    "games",
    ["id", "season_id", "game_date", "game_datetime", "game_type", "game_end_type", "series_id", "series_game_number", "home_team_id", "away_team_id", "home_score", "away_score", "venue", "source"],
    all.map((r) => r.game),
    "id",
    `home_score = excluded.home_score, away_score = excluded.away_score,
     game_end_type = excluded.game_end_type, series_id = coalesce(excluded.series_id, games.series_id),
     series_game_number = coalesce(excluded.series_game_number, games.series_game_number), updated_at = now()`,
  );
  await db.query(games.sql, games.params);

  const skaters = all.flatMap((r) => r.skaters);
  if (skaters.length) {
    const q = buildMultiRowInsert(
      "skater_game_stats",
      ["game_id", "player_id", "team_id", "goals", "assists", "shots", "hits", "blocked_shots", "giveaways", "takeaways", "penalty_minutes", "plus_minus", "pp_goals", "toi_seconds", "source"],
      skaters,
      "game_id, player_id",
      `team_id = excluded.team_id, goals = excluded.goals, assists = excluded.assists, shots = excluded.shots,
       hits = excluded.hits, blocked_shots = excluded.blocked_shots, giveaways = excluded.giveaways,
       takeaways = excluded.takeaways, penalty_minutes = excluded.penalty_minutes, plus_minus = excluded.plus_minus,
       pp_goals = excluded.pp_goals, toi_seconds = excluded.toi_seconds, updated_at = now()`,
    );
    await db.query(q.sql, q.params);
  }
  const goalies = all.flatMap((r) => r.goalies);
  if (goalies.length) {
    const q = buildMultiRowInsert(
      "goalie_game_stats",
      ["game_id", "player_id", "team_id", "decision", "shots_against", "saves", "goals_against", "save_pct", "toi_seconds", "shutout", "source"],
      goalies,
      "game_id, player_id",
      `team_id = excluded.team_id, decision = excluded.decision, shots_against = excluded.shots_against,
       saves = excluded.saves, goals_against = excluded.goals_against, save_pct = excluded.save_pct,
       toi_seconds = excluded.toi_seconds, shutout = excluded.shutout, updated_at = now()`,
    );
    await db.query(q.sql, q.params);
  }

  for (const r of all) {
    const id = r.game[0] as number;
    if (!recheck.has(id) || !r.complete) continue;
    const a = await db.query(`delete from skater_game_stats where game_id = $1 and source = 'nhl-api' and not (player_id = any($2::int[]))`, [id, r.skaters.map((x) => x[1])]);
    const b = await db.query(`delete from goalie_game_stats where game_id = $1 and source = 'nhl-api' and not (player_id = any($2::int[]))`, [id, r.goalies.map((x) => x[1])]);
    if (a.rowCount || b.rowCount) notes.push(`${id}: removed ${a.rowCount} skater and ${b.rowCount} goalie rows the NHL no longer lists`);
  }
  return notes;
}

// The league standings (the NHL's /standings feed) into standings_snapshots,
// one row per team per season, only ever replaced by an at-least-as-complete
// snapshot. See scripts/backfill-season.ts step 7 for the history of why.
export async function writeStandings(db: Queryable, seasonId: string, standings: any[], idsByAbbrev: Map<string, number>): Promise<{ written: number; skipped: string[] }> {
  let written = 0;
  const skipped: string[] = [];
  for (const t of standings) {
    const teamId = idsByAbbrev.get(t.teamAbbrev.default);
    if (!teamId) {
      skipped.push(t.teamAbbrev.default);
      continue;
    }
    await db.query(
      `insert into standings_snapshots
         (team_id, season_id, snapshot_date, division, conference, games_played, wins, losses,
          ot_losses, points, points_pct, goals_for, goals_against, division_rank, conference_rank,
          league_rank, source)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'nhl-api')
       on conflict (team_id, season_id) do update set
         snapshot_date = excluded.snapshot_date, division = excluded.division,
         conference = excluded.conference, games_played = excluded.games_played,
         wins = excluded.wins, losses = excluded.losses, ot_losses = excluded.ot_losses,
         points = excluded.points, points_pct = excluded.points_pct,
         goals_for = excluded.goals_for, goals_against = excluded.goals_against,
         division_rank = excluded.division_rank, conference_rank = excluded.conference_rank,
         league_rank = excluded.league_rank, updated_at = now()
       where excluded.games_played > standings_snapshots.games_played
          or (excluded.games_played = standings_snapshots.games_played
              and excluded.snapshot_date >= standings_snapshots.snapshot_date)`,
      [
        teamId,
        seasonId,
        t.date,
        t.divisionName,
        t.conferenceName,
        t.gamesPlayed,
        t.wins,
        t.losses,
        t.otLosses,
        t.points,
        t.pointPctg,
        t.goalFor,
        t.goalAgainst,
        t.divisionSequence,
        t.conferenceSequence,
        t.leagueSequence,
      ],
    );
    written++;
  }
  return { written, skipped };
}
