// Proves the pipeline end-to-end on one team's one season before we
// commit to a multi-decade, full-league backfill: fetch -> normalize ->
// load, against the real NHL API, into the schema we just built.
//
// Usage: npx tsx scripts/backfill-season.ts [teamAbbrev] [seasonId]
// Defaults to the Bruins' 2024-25 season.
//
// Covers regular season and playoffs, including playoff_series rows
// (grouped by round + opponent, with a derived series winner).
//
// Known, deliberate scope limits for this first pass (see chat for why):
//  - Only one team's schedule is walked, so only that team's roster gets
//    rich bios; opponents' players get a minimal fallback row.
//  - team_game_stats (xG, Corsi) is a separate MoneyPuck integration, not
//    part of this NHL-API-only script.
//  - franchise_id is set equal to team_id (a real franchise-lineage
//    backfill is a later, separate concern).

import { Client } from "pg";
import { gameRows, writeGameRows, writeStandings, type GameRows } from "../lib/game-rows";

const API = "https://api-web.nhle.com/v1";

// Boxscores are fetched a small batch at a time, concurrently. Measured
// directly (re-running PHX 2007-08 before/after, identical row counts both
// times): this alone gave no real speedup — the actual bottleneck turned
// out to be one DB round trip per stat row (~30-40 per game to a remote
// Neon instance), not the NHL API fetch. Kept anyway since it's free and
// harmless; the real win is the multi-row batched inserts below.
const BOXSCORE_BATCH_SIZE = 5;
const RECHECK_HOURS = 48;

// Real bug found live (2026-09-19): a request that stalls mid-flight
// (found here after the host machine's network interface dropped and came
// back — see backfillOnce's comment for the fuller story) never resolves
// AND never throws, so it doesn't just fail — it hangs the whole process
// forever with zero output. A season stuck this way blocks every
// subsequent team in a range-level rollout (backfill-range.sh waits
// synchronously for it), unlike a thrown error, which at least surfaces
// and lets the caller move on. An explicit timeout turns "hangs forever"
// into "fails after 30s", which the retry wrapper in main() can then
// actually catch and act on.
async function fetchJson<T>(url: string, timeoutMs = 30000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Timed out after ${timeoutMs}ms fetching ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return res.json() as Promise<T>;
}

function buildTeamName(placeName: string, commonName: string): string {
  // Most teams: placeName ("Boston") + commonName ("Bruins") -> "Boston
  // Bruins". A placeholder identity like "Utah Hockey Club" already has
  // the place name baked into commonName itself (unlike every other
  // team's mascot-only commonName) — naively concatenating both produces
  // "Utah Utah Hockey Club", confirmed against the live API for exactly
  // that team. Detected generically rather than hardcoding "Utah", in
  // case another team ever gets a similar placeholder identity.
  if (commonName.toLowerCase().startsWith(placeName.toLowerCase())) return commonName;
  return `${placeName} ${commonName}`;
}

// Real bug found live during the full-league rollout (2026-09-19): a
// single Client is held open for one season's entire processing (can be
// hundreds of queries over several minutes for a full 82+ game season),
// with no retry if that connection drops mid-run — a transient network
// blip or a Neon-side connection reset kills the whole season, and the
// caller (backfill-range.sh) just logs it as a permanent failure and moves
// on. Worse: on that error, this function returned without ever calling
// client.end(), leaking the dead connection — which likely made things
// progressively worse over a long run (each leaked connection eating into
// whatever connection limit Neon enforces), matching the real pattern
// observed: a handful of scattered single-season failures early in the
// run, escalating to Philadelphia failing on every one of its first 12
// seasons in a row before this fix. Two changes: guaranteed cleanup via
// try/finally, and retrying the whole season (safe — every write here is
// an upsert) a few times with backoff when the error is connection-shaped,
// rather than a single attempt with no recovery.
// Module-scoped, not local to backfillOnce, so main()'s retry check can
// read it directly instead of trying to smuggle it out through whatever
// error backfillOnce happens to throw. Reset at the start of each attempt.
let connectionDead = false;

async function backfillOnce(teamAbbrev: string, seasonId: string) {
  connectionDead = false;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  // pg's Client emits 'error' on the raw connection as an EventEmitter
  // event; with no listener, an unexpected drop crashes the whole process
  // instantly instead of surfacing as a normal rejected query — which
  // means it skips this exact retry loop entirely. Confirmed live
  // elsewhere (generate-highlights.ts, backfill-team-game-stats.ts), along
  // with a second issue: whatever a query throws AFTER the drop doesn't
  // reliably match CONNECTION_ERROR_PATTERN's text, so main()'s retry
  // check below could treat a genuine dropped connection as a real,
  // non-retryable error and give up instead of reconnecting. This script
  // has no per-item catch to swallow that mislabeling (unlike the other
  // two when this was found), but the flag is still the more honest
  // signal than pattern-matching arbitrary error text either way.
  client.on("error", (err) => {
    connectionDead = true;
    console.error(`pg client error (connection dropped): ${err.message}`);
  });
  await client.connect();

  console.log(`Backfilling ${teamAbbrev} / ${seasonId}...`);

  try {
  // 1. Season schedule for the target team — fetched first because the
  //    real last-game date drives the standings lookup below. (An earlier
  //    version guessed a fixed "April 30" date for standings, which for
  //    some seasons falls after the NHL stops serving data for that date
  //    and silently returns an empty array — no error, just zero rows.
  //    Never guess a date when the real one is one fetch away.)
  const schedule = await fetchJson<{ games: any[] }>(
    `${API}/club-schedule-season/${teamAbbrev}/${seasonId}`,
  );
  const games = schedule.games.filter(
    (g) => (g.gameType === 2 || g.gameType === 3) && (g.gameState === "FINAL" || g.gameState === "OFF"),
  );
  if (games.length === 0) throw new Error("No completed games found.");

  const dates = games.map((g) => g.gameDate).sort();
  await client.query(
    `insert into seasons (id, start_date, end_date) values ($1, $2, $3)
     on conflict (id) do update set start_date = excluded.start_date, end_date = excluded.end_date`,
    [seasonId, dates[0], dates[dates.length - 1]],
  );

  // 2. Standings as of the last *regular-season* game date — not the
  //    season's absolute last game, which in a playoff year is a playoff
  //    game. Standings-by-date stops updating once the regular season
  //    ends (playoff results don't change that table), so asking for a
  //    date deep into the playoffs returns nothing — same silent-empty-
  //    array failure mode as before, just a different wrong date.
  const regularSeasonDates = games
    .filter((g) => g.gameType === 2)
    .map((g) => g.gameDate)
    .sort();
  if (regularSeasonDates.length === 0) throw new Error("No completed regular-season games found.");
  const standingsDate = regularSeasonDates[regularSeasonDates.length - 1];
  const standings = await fetchJson<{ standings: any[] }>(`${API}/standings/${standingsDate}`);
  if (standings.standings.length === 0) {
    throw new Error(`Standings API returned no rows for ${dates[dates.length - 1]}.`);
  }
  const teamMeta = new Map(standings.standings.map((t) => [t.teamAbbrev.default, t]));

  // 3. Upsert every team that appears (home or away) across the schedule,
  //    and remember each one's numeric id by abbreviation — the standings
  //    endpoint identifies teams only by abbreviation, not by id.
  const abbrevToId = new Map<string, number>();
  const teamIds = new Set<number>();
  for (const g of games) {
    teamIds.add(g.homeTeam.id);
    teamIds.add(g.awayTeam.id);
  }
  for (const g of games) {
    for (const side of [g.homeTeam, g.awayTeam]) {
      abbrevToId.set(side.abbrev, side.id);
      if (!teamIds.has(side.id)) continue;
      const meta = teamMeta.get(side.abbrev);
      const teamName = buildTeamName(side.placeName.default, side.commonName.default);
      await client.query(
        `insert into franchises (id, name) values ($1, $2) on conflict (id) do nothing`,
        [side.id, teamName],
      );
      await client.query(
        `insert into teams (id, franchise_id, name, abbrev, city, conference, division, is_active)
         values ($1, $1, $2, $3, $4, $5, $6, true)
         on conflict (id) do update set
           name = excluded.name, abbrev = excluded.abbrev, city = excluded.city,
           conference = excluded.conference, division = excluded.division,
           updated_at = now()`,
        [
          side.id,
          teamName,
          side.abbrev,
          side.placeName.default,
          meta?.conferenceName ?? null,
          meta?.divisionName ?? null,
        ],
      );
      // teams.name/abbrev above is deliberately "current identity only" (see
      // schema description) — this row is the actual historical record: the
      // name/abbrev this team used during this specific season's date range.
      // Without it, a franchise that renamed (Utah Hockey Club -> Utah
      // Mammoth) or relocated shows every past game under whatever name is
      // most recent, which is exactly the "retroactively renaming the past"
      // failure the original schema design set out to avoid.
      await client.query(
        `insert into team_identities (team_id, name, abbrev, start_date, end_date)
         values ($1, $2, $3, $4, $5)
         on conflict (team_id, start_date) do update set
           name = excluded.name, abbrev = excluded.abbrev, end_date = excluded.end_date`,
        [side.id, teamName, side.abbrev, dates[0], dates[dates.length - 1]],
      );
      teamIds.delete(side.id); // upsert each team once
    }
  }

  // 4. Roster (rich bios) for the target team, keyed by player id.
  const roster = await fetchJson<{ forwards: any[]; defensemen: any[]; goalies: any[] }>(
    `${API}/roster/${teamAbbrev}/${seasonId}`,
  );
  const rosterById = new Map(
    [...roster.forwards, ...roster.defensemen, ...roster.goalies].map((p) => [p.id, p]),
  );

  const seenPlayers = new Set<number>();
  async function upsertPlayerFromBoxscore(p: any, teamId: number) {
    if (!seenPlayers.has(p.playerId)) {
      seenPlayers.add(p.playerId);
      const bio = rosterById.get(p.playerId);
      if (bio) {
        // A real bio is available this run — always the better data, so
        // overwrite a prior fallback row from any earlier run. Without
        // this, a player first inserted as a minimal box-score fallback
        // (e.g. their rookie-season roster lookup missed, or they were
        // first seen as an opponent before joining this team) stays stuck
        // with that fallback forever, even once a later season's backfill
        // has their real bio in hand. Found via a real long-tenured Bruin
        // (Marchand) stuck at "B. Marchand" with no birth_date despite
        // 15+ seasons on the roster — the old `do update set updated_at
        // = now()` never re-applied bio data on conflict.
        await client.query(
          `insert into players
             (id, full_name, position, shoots_catches, birth_date, birth_country, height_cm, weight_kg)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           on conflict (id) do update set
             full_name = excluded.full_name,
             position = excluded.position,
             shoots_catches = excluded.shoots_catches,
             birth_date = excluded.birth_date,
             birth_country = excluded.birth_country,
             height_cm = excluded.height_cm,
             weight_kg = excluded.weight_kg,
             updated_at = now()`,
          [
            p.playerId,
            `${bio.firstName.default} ${bio.lastName.default}`,
            p.position === "G" ? "G" : bio.positionCode ?? p.position,
            bio.shootsCatches ?? null,
            bio.birthDate ?? null,
            bio.birthCountry ?? null,
            bio.heightInCentimeters ?? null,
            bio.weightInKilograms ?? null,
          ],
        );
      } else {
        // No bio this run (an opponent, or not on this team's roster this
        // season) — insert the minimal fallback only if the row is new;
        // never downgrade a row that already has a real bio from some
        // other season's processing.
        await client.query(
          `insert into players (id, full_name, position)
           values ($1, $2, $3)
           on conflict (id) do update set updated_at = now()`,
          [p.playerId, p.name.default, p.position],
        );
      }
    }
    await client.query(
      `insert into player_team_seasons (player_id, team_id, season_id, jersey_number)
       values ($1, $2, $3, $4)
       on conflict (player_id, team_id, season_id) do update set jersey_number = excluded.jersey_number`,
      [p.playerId, teamId, seasonId, p.sweaterNumber ?? null],
    );
  }

  // 5. Playoff series: group playoff games by round+opponent, upsert one
  //    series row per matchup, and remember each game's series id/game
  //    number so the game insert below can attach them.
  const targetTeamId = abbrevToId.get(teamAbbrev);
  if (!targetTeamId) throw new Error(`Could not resolve team id for ${teamAbbrev}`);

  const gameSeriesInfo = new Map<number, { seriesId: number; gameNumber: number }>();
  const seriesGroups = new Map<string, any[]>();
  for (const g of games) {
    if (g.gameType !== 3 || !g.seriesStatus) continue;
    const opponentId = g.homeTeam.id === targetTeamId ? g.awayTeam.id : g.homeTeam.id;
    const key = `${g.seriesStatus.round}-${opponentId}`;
    if (!seriesGroups.has(key)) seriesGroups.set(key, []);
    seriesGroups.get(key)!.push(g);
  }
  for (const [key, seriesGames] of seriesGroups) {
    const opponentId = Number(key.split("-")[1]);
    const round = seriesGames[0].seriesStatus.round;
    const neededToWin = seriesGames[0].seriesStatus.neededToWin ?? 4;
    let targetWins = 0;
    let opponentWins = 0;
    for (const g of seriesGames) {
      const targetIsHome = g.homeTeam.id === targetTeamId;
      const targetScore = targetIsHome ? g.homeTeam.score : g.awayTeam.score;
      const opponentScore = targetIsHome ? g.awayTeam.score : g.homeTeam.score;
      if (targetScore > opponentScore) targetWins++;
      else opponentWins++;
    }
    const winnerTeamId =
      targetWins >= neededToWin ? targetTeamId : opponentWins >= neededToWin ? opponentId : null;

    // team_a_id/team_b_id must be assigned the SAME way no matter which of
    // the two teams' backfill run creates this row — the two teams in a
    // series each run this exact insert independently (this team as
    // "target", the other as "opponent"), so if team_a/b just meant
    // "target, opponent" the ON CONFLICT target wouldn't match between the
    // two runs and every playoff series would get inserted twice: one row
    // per team, the second one silently orphaned (no games ever attach to
    // it, since the games insert below always points at whichever row
    // THIS run's own gameSeriesInfo resolved). Found live: BOS/BUF round 1
    // 2025-26 showing twice on the playoff history page, one stuck at 0-0.
    // Ordering by id instead of by "target vs. opponent" makes the pair
    // symmetric, so both runs resolve to the same row.
    const teamAId = Math.min(targetTeamId, opponentId);
    const teamBId = Math.max(targetTeamId, opponentId);

    const res = await client.query(
      `insert into playoff_series (season_id, round, team_a_id, team_b_id, winner_team_id, games_played)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (season_id, round, team_a_id, team_b_id) do update set
         winner_team_id = excluded.winner_team_id, games_played = excluded.games_played
       returning id`,
      [seasonId, round, teamAId, teamBId, winnerTeamId, seriesGames.length],
    );
    const seriesId = res.rows[0].id;
    for (const g of seriesGames) {
      gameSeriesInfo.set(g.id, { seriesId, gameNumber: g.seriesStatus.gameNumberOfSeries });
    }
  }

  // 6. Walk every game: upsert the game row, then its full boxscore.
  // Boxscores are fetched a small batch at a time, concurrently. The real
  // win, measured directly, is batching every game's stat rows into one
  // multi-row INSERT each for skaters and goalies, instead of one INSERT
  // per player (the actual per-row DB round trip was the bottleneck, not
  // the API fetch). Same ON CONFLICT semantics as before, per row — this
  // only changes how many round trips it costs to write them.
  //
  // Only fetch games NOT already loaded — this script was originally
  // built to re-fetch every completed game unconditionally every run,
  // which is fine for a one-time historical backfill but not for a cron
  // job re-running this hourly during the season: by mid-season that
  // would mean re-fetching dozens of already-loaded games per team, every
  // run, for no reason. A game already having a row in our own `games`
  // table (inserted alongside its boxscore in this same loop, previous
  // run) is the signal that its stats are already in.
  const { rows: alreadyLoaded } = await client.query(
    `select id from games where id = any($1::int[])`,
    [games.map((g) => g.id)],
  );
  //
  // Except the last 48 hours: the NHL corrects box scores after a game
  // (a goal's on-ice players, a shot taken back), and a game loaded the
  // night it ended kept the first version forever. Found 2026-10-03:
  // Winnipeg's plus-minus from the night before and a Guentzel shot from
  // two nights before no longer matched the NHL. Re-fetched games are
  // overwritten below, every stat, and players the NHL dropped are removed.
  const loadedIds = new Set(alreadyLoaded.map((r) => r.id));
  const recheckFrom = new Date(Date.now() - RECHECK_HOURS * 3600_000).toISOString().slice(0, 10);
  const gamesToFetch = games.filter((g) => !loadedIds.has(g.id) || g.gameDate >= recheckFrom);
  const rechecks = gamesToFetch.filter((g) => loadedIds.has(g.id)).length;
  console.log(`${gamesToFetch.length - rechecks} of ${games.length} completed games need fetching (${loadedIds.size} already loaded; ${rechecks} from the last ${RECHECK_HOURS} hours re-checked).`);

  let count = 0;
  for (let i = 0; i < gamesToFetch.length; i += BOXSCORE_BATCH_SIZE) {
    const batch = gamesToFetch.slice(i, i + BOXSCORE_BATCH_SIZE);
    const boxscores = await Promise.all(
      batch.map((g) => fetchJson<any>(`${API}/gamecenter/${g.id}/boxscore`)),
    );

    // Rows for each game, built by lib/game-rows.ts (shared with the
    // site's load-on-final, so the rules live in one place).
    const built: GameRows[] = [];
    for (let j = 0; j < batch.length; j++) {
      const rows = gameRows(seasonId, batch[j], boxscores[j], gameSeriesInfo.get(batch[j].id));
      for (const { p, teamId } of rows.players) await upsertPlayerFromBoxscore(p, teamId);
      built.push(rows);
      count++;
      if (count % 10 === 0) console.log(`  ${count}/${gamesToFetch.length} games loaded`);
    }
    for (const note of await writeGameRows(client, built, loadedIds)) console.log(`  ${note}`);
  }

  // 7. One standings snapshot per team per season — not per team per date.
  //    Real bug found live during the full-league rollout (2026-09-18):
  //    the "as of" date here is this processing team's own last
  //    regular-season game date, which differs team-to-team in a
  //    rescheduled season, so a naive per-date upsert created a fresh row
  //    every time a different team's run touched the same opponent,
  //    leaving whichever snapshot happened to be inserted last — not
  //    necessarily the most complete one — as one of several rows for the
  //    same team+season. Keyed on (team_id, season_id) now, and only
  //    overwritten when at least as complete (games_played can only grow
  //    across a season, so the highest games_played is always the most
  //    complete/final snapshot available), so this can't regress no
  //    matter which team's run processes a given opponent last. On a tie in
  //    games_played the newer snapshot wins, so a team whose own last game
  //    is older can't roll back the ranks (which move as other teams play).
  //
  //    Early in a season abbrevToId only knows this team and the opponents
  //    it has already played, so every other team's row was skipped: after
  //    the 2026-27 opener only 10 of 32 teams had a snapshot. For the newest
  //    season only, fill the gaps from the active teams in the database.
  //    Not for past seasons: an abbrev can belong to more than one team id
  //    over time (UTA is both Utah Hockey Club, 59, and Utah Mammoth, 68),
  //    and only the active one is right for the current season.
  const standingsIds = new Map(abbrevToId);
  const { rows: newestSeason } = await client.query(`select max(id) as id from seasons`);
  if (newestSeason[0]?.id === seasonId) {
    const { rows: activeTeams } = await client.query(`select id, abbrev from teams where is_active`);
    for (const r of activeTeams) {
      if (!standingsIds.has(r.abbrev)) standingsIds.set(r.abbrev, Number(r.id));
    }
  }

  const { written: standingsWritten, skipped: noId } = await writeStandings(client, seasonId, standings.standings, standingsIds);
  for (const abbrev of noId) console.warn(`  no team id for ${abbrev}, skipping standings row`);

  console.log(
    `Done. ${gamesToFetch.length - rechecks} new games fetched, ${rechecks} re-checked (${games.length} completed total), ${seenPlayers.size} players touched, ${standingsWritten} standings rows loaded.`,
  );
  } finally {
    // Always release the connection, success or failure — the missing
    // half of this fix (see the comment on backfillOnce above): a leaked
    // connection on every failure is what turned a handful of transient
    // drops into Philadelphia failing 12 seasons in a row.
    await client.end().catch(() => {});
  }
}

// A connection can drop mid-run for reasons that have nothing to do with
// this script's own logic (see backfillOnce's comment) — retrying the
// whole season is safe (every write is an upsert) and cheap relative to
// just giving up. A non-connection error (a real bug, a malformed
// response) is NOT retried — it fails immediately so it surfaces instead
// of silently retrying something that will never succeed.
const CONNECTION_ERROR_PATTERN = /ECONNRESET|ETIMEDOUT|Connection terminated|connect ECONNREFUSED|EPIPE|Timed out after \d+ms/i;

async function main() {
  const teamAbbrev = process.argv[2] ?? "BOS";
  const seasonId = process.argv[3] ?? "20242025";
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await backfillOnce(teamAbbrev, seasonId);
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isConnectionError = connectionDead || CONNECTION_ERROR_PATTERN.test(message);
      if (!isConnectionError || attempt === maxAttempts) throw err;
      const waitMs = 1000 * 2 ** attempt;
      console.log(`Connection error on attempt ${attempt}/${maxAttempts} (${message}) — retrying in ${waitMs}ms...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
