// Tier 1 post-game significance checks — see the "Second signature feature"
// section of the sports-apps-vision skill for the full design rationale
// and the anti-garbage rules every check here follows.
//
// Scoping: every check here is only correct for a team whose full loaded
// history we actually have (currently BOS). A real batch run over 2007-25
// caught this the hard way — a check fired for Tomas Plekanec (Montreal),
// computing a "6-game point streak" from only the games he happened to
// play against Boston, not his real schedule. That's not rare-and-real,
// it's an artifact of incomplete data. Every candidate-selection query
// below now filters to TARGET_TEAM_ABBREV explicitly — this was
// previously only a comment, not enforced, which is exactly how it broke.

import { Client } from "pg";

export const TARGET_TEAM_ABBREV = "BOS";

export type SignificanceFact = {
  category: string;
  population: string; // what this is being compared against — never ambiguous
  fact: string; // human-readable, ready to hand to the narration step
};

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

async function getTargetTeamId(client: Client): Promise<number> {
  const { rows } = await client.query("select id from teams where abbrev = $1", [TARGET_TEAM_ABBREV]);
  if (!rows[0]) throw new Error(`Target team ${TARGET_TEAM_ABBREV} not found in teams table.`);
  return rows[0].id;
}

/**
 * hasFullCareerLoaded only rules out "too old to have debuted before our
 * data starts" — it says nothing about whether the player spent time on a
 * DIFFERENT team we never backfilled before joining this one. A player
 * traded to Boston mid-career passes the age check while we're still
 * missing his entire prior stint, which produces exactly the same failure
 * as the Plekanec bug (a confident claim built on a partial game log).
 * This checks the loaded rows themselves: if every one of them belongs to
 * the target team, there's no unseen stint to worry about.
 */
// Whether, as of a given game, every game on file for this player was for
// this team. Bounded to that game's date: unbounded, a player's LATER
// stints elsewhere retroactively disqualified claims that were true that
// night (Ryan Spooner's real 100th career point, January 2017, stopped
// qualifying once his 2018 Rangers games were loaded).
async function playedOnlyForTeam(
  client: Client,
  playerId: number,
  targetTeamId: number,
  table: "skater_game_stats" | "goalie_game_stats",
  asOfGameId: number,
): Promise<boolean> {
  const { rows } = await client.query(
    `select count(*) from ${table} s join games g on g.id = s.game_id
     where s.player_id = $1 and s.team_id != $2
       and g.game_date <= (select game_date from games where id = $3)`,
    [playerId, targetTeamId, asOfGameId],
  );
  return Number(rows[0].count) === 0;
}

const EARLIEST_LOADED_SEASON_START = new Date("2007-09-01");
const MIN_DEBUT_AGE_YEARS = 19; // conservative — real minimum is ~18

/**
 * Whether we can trust a "career" or "all-time" claim about this player,
 * i.e. whether their loaded data plausibly covers their entire NHL career.
 * Returns false (never guesses true) when birth_date is missing — which
 * happens for players who joined mid-season after that season's roster
 * snapshot was already fetched (a real gap found while building this).
 */
export function hasFullCareerLoaded(birthDate: string | null): boolean {
  if (!birthDate) return false;
  const earliestPossibleDebut = new Date(birthDate);
  earliestPossibleDebut.setFullYear(earliestPossibleDebut.getFullYear() + MIN_DEBUT_AGE_YEARS);
  return earliestPossibleDebut > EARLIEST_LOADED_SEASON_START;
}

async function getGame(client: Client, gameId: number) {
  const { rows } = await client.query(
    `select g.*, ht.abbrev as home_abbrev, at.abbrev as away_abbrev
     from games g join teams ht on ht.id = g.home_team_id join teams at on at.id = g.away_team_id
     where g.id = $1`,
    [gameId],
  );
  return rows[0] ?? null;
}

// --- Check 1 & 2: point streak extending or snapping ------------------

const STREAK_FLOOR = 5; // below this, not worth mentioning even as a new high

export async function checkPointStreaks(client: Client, gameId: number, targetTeamId: number): Promise<SignificanceFact[]> {
  const game = await getGame(client, gameId);
  if (!game) return [];
  const facts: SignificanceFact[] = [];
  // Point streaks are a regular-season, single-season stat in the NHL's
  // own record-keeping: they reset every season and playoff games don't
  // count toward them. The log below was once every game on file, so an
  // opening-night point would have "extended" a streak spanning the
  // offseason and last spring's playoffs.
  if (game.game_type !== "regular") return facts;

  const { rows: skaters } = await client.query(
    `select s.player_id, p.full_name, p.birth_date
     from skater_game_stats s join players p on p.id = s.player_id
     where s.game_id = $1 and s.team_id = $2`,
    [gameId, targetTeamId],
  );

  for (const skater of skaters) {
    // Filtered to targetTeamId, not just player_id — without this, a
    // player's sparse pre-trade appearances against Boston (for his old
    // team) would splice into this log as if they were consecutive games
    // for this team, corrupting the streak count itself, not just its label.
    // Bounded to this game's date so re-narrating an old game can't see
    // later seasons.
    const { rows: log } = await client.query(
      `select g.id as game_id, g.season_id, g.game_date, (s.points > 0) as scored
       from skater_game_stats s join games g on g.id = s.game_id
       where s.player_id = $1 and s.team_id = $2 and g.game_type = 'regular' and g.game_date <= $3
       order by g.game_date asc`,
      [skater.player_id, targetTeamId, game.game_date],
    );
    const idx = log.findIndex((r) => r.game_id === gameId);
    if (idx === -1) continue;
    const sameSeason = (i: number) => log[i].season_id === game.season_id;

    // Current streak ending at this game, within this season only.
    let current = 0;
    for (let i = idx; i >= 0 && sameSeason(i) && log[i].scored; i--) current++;

    // His longest earlier streak on file (each season counted separately),
    // to tell a new personal best from a tie or a shorter run.
    let longestBefore = 0;
    let running = 0;
    for (let i = 0; i <= idx - current; i++) {
      if (i > 0 && log[i].season_id !== log[i - 1].season_id) running = 0;
      running = log[i].scored ? running + 1 : 0;
      longestBefore = Math.max(longestBefore, running);
    }

    const fullCareer =
      hasFullCareerLoaded(skater.birth_date) &&
      (await playedOnlyForTeam(client, skater.player_id, targetTeamId, "skater_game_stats", gameId));
    // The log is this team's games only, so unless his whole career is
    // verifiably here, the honest population is "with this team".
    const teamAbbrev = targetTeamId === game.home_team_id ? game.home_abbrev : game.away_abbrev;
    const population = fullCareer ? "this player's full career" : `his games with ${teamAbbrev} (since 2007-08)`;

    // Only a NEW personal best counts — a tie at the 5-game floor fired
    // constantly in an audit of stored highlights and isn't notable. Worded
    // as HIS best, never a bare "longest of the era", which read like a
    // league or franchise record.
    if (log[idx].scored && current >= STREAK_FLOOR && current > longestBefore) {
      facts.push({
        category: "point_streak_extending",
        population,
        fact: `${skater.full_name} has a ${current}-game point streak, ${fullCareer ? "the longest of his career" : `his longest with ${teamAbbrev}`}.`,
      });
    }

    if (!log[idx].scored && idx > 0 && sameSeason(idx - 1)) {
      // Streak ending at the game immediately before this one (same season).
      let priorStreak = 0;
      for (let i = idx - 1; i >= 0 && sameSeason(i) && log[i].scored; i--) priorStreak++;
      if (priorStreak >= STREAK_FLOOR) {
        facts.push({
          category: "point_streak_snapped",
          population,
          fact: `${skater.full_name}'s ${priorStreak}-game point streak ended tonight.`,
        });
      }
    }
  }
  return facts;
}

// --- Check 3: multi-goal game by a defenseman --------------------------

export async function checkDefensemanMultiGoal(client: Client, gameId: number, targetTeamId: number): Promise<SignificanceFact[]> {
  const { rows } = await client.query(
    `select s.player_id, p.full_name, s.goals, s.team_id
     from skater_game_stats s
     join players p on p.id = s.player_id
     where s.game_id = $1 and s.team_id = $2 and p.position = 'D' and s.goals >= 2`,
    [gameId, targetTeamId],
  );
  const facts: SignificanceFact[] = [];
  for (const row of rows) {
    const { rows: countRows } = await client.query(
      `select count(*) from skater_game_stats s
       join players p on p.id = s.player_id
       join games g on g.id = s.game_id
       where s.team_id = $1 and p.position = 'D' and s.goals >= 2
         and g.game_date <= (select game_date from games where id = $2)`,
      [row.team_id, gameId],
    );
    facts.push({
      category: "defenseman_multi_goal",
      population: "this team's loaded history",
      fact: `${row.full_name} scored ${row.goals} goals — the ${ordinal(Number(countRows[0].count))} multi-goal game by a defenseman on this team since 2007-08.`,
    });
  }
  return facts;
}

// --- Check 4: multi-point rookie game -----------------------------------
// Simplified rookie proxy, not the full NHL eligibility rule (missing the
// two-prior-seasons-of-6-games clause and the age-26 cutoff) — documented
// limitation, not silently pretended to be the official rule.

export async function checkRookieMultiPoint(client: Client, gameId: number, targetTeamId: number): Promise<SignificanceFact[]> {
  const { rows } = await client.query(
    `select s.player_id, p.full_name, p.birth_date, s.team_id, s.points, g.game_date
     from skater_game_stats s
     join players p on p.id = s.player_id
     join games g on g.id = s.game_id
     where s.game_id = $1 and s.team_id = $2 and s.points >= 3`,
    [gameId, targetTeamId],
  );
  const facts: SignificanceFact[] = [];
  for (const row of rows) {
    if (!hasFullCareerLoaded(row.birth_date)) continue; // can't verify rookie status — skip, don't guess
    if (!(await playedOnlyForTeam(client, row.player_id, targetTeamId, "skater_game_stats", gameId))) continue; // has a stint elsewhere we don't have full data for — can't trust the games-played proxy

    // The games-count proxy alone isn't enough: a veteran who joined this
    // team recently (played for another team we never backfilled) can look
    // like a "rookie" by games-played-for-this-team, despite being a decade
    // into his career. Found via a real test case (a 30-year-old newly
    // traded to Boston, not a rookie by any definition). An age ceiling
    // catches this even when the games-count signal is fooled — real NHL
    // rookies are essentially always young.
    const ageAtGame =
      (new Date(row.game_date).getTime() - new Date(row.birth_date).getTime()) / (365.25 * 24 * 3600 * 1000);
    if (ageAtGame > 23) continue;

    const { rows: priorGames } = await client.query(
      `select count(*) from skater_game_stats s join games g on g.id = s.game_id
       where s.player_id = $1 and g.game_date < (select game_date from games where id = $2)`,
      [row.player_id, gameId],
    );
    if (Number(priorGames[0].count) >= 25) continue; // not a rookie by our proxy rule

    const { rows: record } = await client.query(
      `select max(s.points) as best from skater_game_stats s
       join players p on p.id = s.player_id
       where s.team_id = $1 and p.birth_date is not null`,
      [row.team_id],
    );
    facts.push({
      category: "rookie_multi_point",
      population: "this team's rookie games (proxy rule: <25 prior NHL games)",
      fact: `${row.full_name} recorded a ${row.points}-point game as a rookie.${
        Number(record[0].best) === row.points ? " Ties the team's rookie single-game point mark in loaded data." : ""
      }`,
    });
  }
  return facts;
}

// --- Check 6/7: career milestones and first career shutout --------------

const GOAL_MILESTONES = [50, 100, 200, 300, 400, 500];
const POINT_MILESTONES = [100, 200, 500, 1000];
const WIN_MILESTONES = [50, 100, 200, 300];

export async function checkMilestones(client: Client, gameId: number, targetTeamId: number): Promise<SignificanceFact[]> {
  const facts: SignificanceFact[] = [];

  // Career milestones are regular-season counts, the way the NHL and every
  // broadcast state them. A playoff game can't reach one, and every total
  // below is regular season only and bounded to this game's date (the win
  // and shutout counts once weren't date-bounded, so re-narrating an old
  // game could see wins or shutouts from later seasons).
  const { rows: thisGame } = await client.query(`select game_type from games where id = $1`, [gameId]);
  if (thisGame[0]?.game_type !== "regular") return facts;
  const PRIOR_REGULAR_GAMES = `game_id in (select id from games where game_type = 'regular'
       and game_date <= (select game_date from games where id = $2))`;

  const { rows: skaters } = await client.query(
    `select s.player_id, p.full_name, p.birth_date, s.goals, s.assists
     from skater_game_stats s join players p on p.id = s.player_id
     where s.game_id = $1 and s.team_id = $2`,
    [gameId, targetTeamId],
  );
  for (const skater of skaters) {
    if (!hasFullCareerLoaded(skater.birth_date)) continue;
    if (!(await playedOnlyForTeam(client, skater.player_id, targetTeamId, "skater_game_stats", gameId))) continue;
    const { rows: totals } = await client.query(
      `select coalesce(sum(goals),0) as goals, coalesce(sum(goals+assists),0) as points
       from skater_game_stats where player_id = $1 and game_id != $2
       and ${PRIOR_REGULAR_GAMES}`,
      [skater.player_id, gameId],
    );
    const priorGoals = Number(totals[0].goals);
    const priorPoints = Number(totals[0].points);
    const nowGoals = priorGoals + skater.goals;
    const nowPoints = priorPoints + skater.goals + skater.assists;

    for (const m of GOAL_MILESTONES) {
      if (priorGoals < m && nowGoals >= m) {
        facts.push({ category: "career_milestone", population: "career total (fully loaded)", fact: `${skater.full_name} scored his ${m}th career goal.` });
      }
    }
    for (const m of POINT_MILESTONES) {
      if (priorPoints < m && nowPoints >= m) {
        facts.push({ category: "career_milestone", population: "career total (fully loaded)", fact: `${skater.full_name} recorded his ${m}th career point.` });
      }
    }
  }

  const { rows: goalies } = await client.query(
    `select s.player_id, p.full_name, p.birth_date, s.decision, s.shutout
     from goalie_game_stats s join players p on p.id = s.player_id
     where s.game_id = $1 and s.team_id = $2`,
    [gameId, targetTeamId],
  );
  for (const goalie of goalies) {
    if (!hasFullCareerLoaded(goalie.birth_date)) continue;
    if (!(await playedOnlyForTeam(client, goalie.player_id, targetTeamId, "goalie_game_stats", gameId))) continue;
    if (goalie.decision === "W") {
      const { rows: winTotal } = await client.query(
        `select count(*) from goalie_game_stats where player_id = $1 and decision = 'W'
         and (game_id = $2 or ${PRIOR_REGULAR_GAMES})`,
        [goalie.player_id, gameId],
      );
      const wins = Number(winTotal[0].count);
      if (WIN_MILESTONES.includes(wins)) {
        facts.push({ category: "career_milestone", population: "career total (fully loaded)", fact: `${goalie.full_name} earned his ${wins}th career win.` });
      }
    }
    if (goalie.shutout) {
      const { rows: priorShutouts } = await client.query(
        `select count(*) from goalie_game_stats where player_id = $1 and shutout = true and game_id != $2
         and ${PRIOR_REGULAR_GAMES}`,
        [goalie.player_id, gameId],
      );
      if (Number(priorShutouts[0].count) === 0) {
        facts.push({ category: "first_career_shutout", population: "career total (fully loaded)", fact: `${goalie.full_name} recorded his first career shutout.` });
      }
    }
  }
  return facts;
}

// --- Check 5: head-to-head rarity (shutout vs. this specific opponent) --

// Floor: a raw calendar gap ("since last March") is meaningless against a
// team Bruins only play once a year — every shutout would trivially be
// "first since the last meeting." Require enough real meetings in between
// that "hasn't happened in a while" is actually true, not just an artifact
// of a thin schedule. Found and fixed only because a real test case (a
// once-a-year interconference opponent) exposed it.
const MIN_MEETINGS_SINCE_LAST_SHUTOUT = 5;

export async function checkHeadToHeadShutout(client: Client, gameId: number): Promise<SignificanceFact[]> {
  const game = await getGame(client, gameId);
  if (!game) return [];
  if (game.home_score !== 0 && game.away_score !== 0) return [];

  const shutoutTeamId = game.home_score === 0 ? game.away_team_id : game.home_team_id;
  const shutTeamId = game.home_score === 0 ? game.home_team_id : game.away_team_id;
  const shutoutTeam = game.home_score === 0 ? game.away_abbrev : game.home_abbrev;
  const shutTeam = game.home_score === 0 ? game.home_abbrev : game.away_abbrev;

  const { rows: meetings } = await client.query(
    `select id, game_date, home_team_id, home_score, away_score from games
     where ((home_team_id = $1 and away_team_id = $2) or (home_team_id = $2 and away_team_id = $1))
       and game_date <= $3
     order by game_date desc`,
    [shutoutTeamId, shutTeamId, game.game_date],
  );

  let meetingsSinceLastShutout = 0;
  for (const m of meetings) {
    meetingsSinceLastShutout++;
    if (m.id === gameId) continue;
    const shutoutTeamWasHome = m.home_team_id === shutoutTeamId;
    const shutTeamScore = shutoutTeamWasHome ? m.away_score : m.home_score;
    if (shutTeamScore === 0) break; // found the prior shutout, stop counting
  }

  if (meetingsSinceLastShutout < MIN_MEETINGS_SINCE_LAST_SHUTOUT) return [];

  const fact =
    meetingsSinceLastShutout === meetings.length
      ? `First shutout of ${shutTeam} by ${shutoutTeam} in loaded history (since 2007-08) across ${meetings.length} meetings.`
      : `${shutoutTeam}'s first shutout of ${shutTeam} in ${meetingsSinceLastShutout} meetings.`;

  return [{ category: "head_to_head_shutout", population: "head-to-head, loaded data only", fact }];
}

// --- Check 8: individual scoring feats ---------------------------------
//
// The most broadcast-nameable things a skater can do in one game, which the
// original checks had no way to see: a 4-goal, 6-assist night against the
// Rangers (2026-01-10) produced no highlight at all. One fact per player,
// headlined by the rarest qualifying stat (a 4-goal, 1-assist game is a
// 4-goal game first, not also a separate 5-point fact). Populations are
// stated and compared like-for-like:
//   hat trick                  this team's games this season (common enough
//                              league-wide that all-time counts mean little)
//   4+ goals / 4+ assists /
//   5+ points                  this team's games of the same type since the
//                              data begins (2007-08), counted as of this game
const FEATS = [
  { stat: "goals", min: 3 },
  { stat: "assists", min: 4 },
  { stat: "points", min: 5 },
] as const;

export async function checkScoringFeats(client: Client, gameId: number, targetTeamId: number): Promise<SignificanceFact[]> {
  const game = await getGame(client, gameId);
  if (!game || (game.game_type !== "regular" && game.game_type !== "playoff")) return [];
  const teamAbbrev = targetTeamId === game.home_team_id ? game.home_abbrev : game.away_abbrev;
  const gameKind = game.game_type === "playoff" ? "playoff" : "regular-season";
  const seasonLabel = `${String(game.season_id).slice(0, 4)}-${String(game.season_id).slice(6, 8)}`;

  const { rows: skaters } = await client.query(
    `select s.player_id, p.full_name, s.goals, s.assists, (s.goals + s.assists) as points
     from skater_game_stats s join players p on p.id = s.player_id
     where s.game_id = $1 and s.team_id = $2 and (s.goals >= 3 or s.assists >= 4 or s.goals + s.assists >= 5)`,
    [gameId, targetTeamId],
  );

  const facts: SignificanceFact[] = [];
  for (const sk of skaters) {
    const line = `${sk.goals} G, ${sk.assists} A`;
    let best: { stat: string; value: number; prior: number; seasonPrior: number } | null = null;
    for (const feat of FEATS) {
      const value = Number(sk[feat.stat]);
      if (value < feat.min) continue;
      const { rows } = await client.query(
        `select count(*) filter (where true)::int as prior,
                count(*) filter (where g.season_id = $4)::int as season_prior
         from skater_game_stats s join games g on g.id = s.game_id
         where s.team_id = $1 and g.game_type = $2 and g.game_date < $3
           and ${feat.stat === "points" ? "s.goals + s.assists" : `s.${feat.stat}`} >= $5`,
        [targetTeamId, game.game_type, game.game_date, game.season_id, value],
      );
      const candidate = { stat: feat.stat, value, prior: rows[0].prior, seasonPrior: rows[0].season_prior };
      // Rarest wins: the fewest prior games at or above this mark. A plain
      // hat trick is only the headline if nothing rarer qualifies.
      if (!best || candidate.prior < best.prior) best = candidate;
    }
    if (!best) continue;

    if (best.stat === "goals" && best.value === 3) {
      facts.push({
        category: "scoring_feat",
        population: `${teamAbbrev} ${gameKind} games, ${seasonLabel} season`,
        fact: `${sk.full_name} scored a hat trick (${line}) — ${teamAbbrev}'s ${ordinal(best.seasonPrior + 1)} ${gameKind === "playoff" ? "playoff " : ""}hat trick of the ${seasonLabel} season.`,
      });
      continue;
    }
    const label = `${best.value}${best.stat === "goals" ? " goals" : best.stat === "assists" ? " assists" : " points"}`;
    facts.push({
      category: "scoring_feat",
      population: `${teamAbbrev} ${gameKind} games since 2007-08 (loaded data)`,
      fact:
        best.prior === 0
          ? `${sk.full_name} had ${label} (${line}) — the first time a ${teamAbbrev} player has had ${best.value}+ ${best.stat} in a ${gameKind} game since 2007-08.`
          : `${sk.full_name} had ${label} (${line}) — the ${ordinal(best.prior + 1)} time a ${teamAbbrev} player has had ${best.value}+ ${best.stat} in a ${gameKind} game since 2007-08.`,
    });
  }
  return facts;
}

export async function runSignificanceChecks(client: Client, gameId: number): Promise<SignificanceFact[]> {
  // Sequential, not Promise.all — a single pg.Client handles one query at a
  // time; running these concurrently against the same connection is unsafe
  // (caught via a real deprecation warning while testing, not by inspection).
  const targetTeamId = await getTargetTeamId(client);
  const facts: SignificanceFact[] = [];
  facts.push(...(await checkPointStreaks(client, gameId, targetTeamId)));
  facts.push(...(await checkDefensemanMultiGoal(client, gameId, targetTeamId)));
  facts.push(...(await checkRookieMultiPoint(client, gameId, targetTeamId)));
  facts.push(...(await checkMilestones(client, gameId, targetTeamId)));
  facts.push(...(await checkHeadToHeadShutout(client, gameId)));
  const feats = await checkScoringFeats(client, gameId, targetTeamId);
  facts.push(...feats);
  // Dedupe overlapping claims about one performance: a defenseman's hat
  // trick is a scoring feat first; the "multi-goal game by a defenseman"
  // fact about the same player would be a second callout for one thing.
  const featNames = feats.map((f) => f.fact.split(" scored ")[0].split(" had ")[0]);
  return facts.filter((f) => !(f.category === "defenseman_multi_goal" && featNames.some((n) => f.fact.startsWith(n))));
}
