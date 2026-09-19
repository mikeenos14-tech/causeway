// A lightweight, automated health check for one team's backfill — built
// 2026-09-17 after a real bug (short-tenure players staying abbreviated
// forever) sat undetected across two completed teams until a manual spot-
// check happened to catch it. The point of this script is to make that
// kind of check automatic and cheap enough to run after every team, not
// something that depends on someone remembering to look.
//
// Exports verifyTeam() so scripts/checkpoint.ts can chain verify -> auto-
// repair -> re-verify into one command instead of two manual steps.
//
// Usage: npx tsx scripts/verify-team.ts <ABBREV>

import { Client } from "pg";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type VerifyResult = {
  found: boolean;
  team?: { id: number; name: string; abbrev: string };
  issues: string[];
  degradedCount: number;
};

export async function verifyTeam(client: Client, abbrev: string): Promise<VerifyResult> {
  const issues: string[] = [];

  const { rows: teamRows } = await client.query(
    `select id, name, abbrev from teams where abbrev = $1`,
    [abbrev],
  );
  if (teamRows.length === 0) {
    return { found: false, issues: [], degradedCount: 0 };
  }
  const team = teamRows[0];

  // Malformed name check (the "Utah Utah Hockey Club" bug pattern): a
  // place name's own words shouldn't repeat inside the team name.
  const placeWords = team.name.split(" ");
  if (placeWords.length >= 2 && team.name.split(placeWords[0]).length > 2) {
    issues.push(`Team name looks malformed (repeated word): "${team.name}"`);
  }

  // Game counts per season — flag anything wildly outside a plausible
  // band. 2012-13 (lockout, ~48) and covid-affected seasons are real,
  // legitimate low outliers, not bugs — this is a loose sanity net, not a
  // strict rule, intentionally wide to avoid false alarms on those.
  const { rows: bySeason } = await client.query(
    `select season_id, count(*) as games
     from games where home_team_id = $1 or away_team_id = $1
     group by season_id order by season_id`,
    [team.id],
  );
  for (const s of bySeason) {
    const games = Number(s.games);
    if (games < 20 || games > 110) {
      issues.push(`Season ${s.season_id} has ${games} games — outside the plausible 20-110 range.`);
    }
  }

  // Standings coverage — every loaded season should have exactly one
  // standings snapshot for this team, and it should be complete (games_played
  // close to the team's actual game count that season). Added 2026-09-18
  // after a real bug: the standings write used to be keyed on
  // (team_id, snapshot_date), so a rescheduled season could leave a team
  // with several rows for the same season_id, some stuck on a stale,
  // incomplete snapshot with no guarantee a query would pick the final one.
  // Fixed at the source (backfill-season.ts) and a (team_id, season_id)
  // unique constraint now makes duplicates impossible going forward — this
  // check is the second line of defense, confirming the one row that
  // exists is actually the complete, final one.
  const { rows: standingsRows } = await client.query(
    `select season_id, games_played, count(*) as n
     from standings_snapshots where team_id = $1
     group by season_id, games_played`,
    [team.id],
  );
  const standingsBySeason = new Map<string, number>();
  for (const r of standingsRows) {
    standingsBySeason.set(r.season_id, (standingsBySeason.get(r.season_id) ?? 0) + Number(r.n));
  }
  const gamesPlayedBySeason = new Map(standingsRows.map((r) => [r.season_id, Number(r.games_played)]));

  // games_played on a standings row is regular-season only — compare
  // against regular-season game count, not bySeason's total (which
  // includes playoffs), or every playoff season false-positives.
  const { rows: regSeasonBySeason } = await client.query(
    `select season_id, count(*) as games
     from games where (home_team_id = $1 or away_team_id = $1) and game_type = 'regular'
     group by season_id`,
    [team.id],
  );
  const regularGamesBySeason = new Map(regSeasonBySeason.map((r) => [r.season_id, Number(r.games)]));

  for (const s of bySeason) {
    const rowCount = standingsBySeason.get(s.season_id) ?? 0;
    if (rowCount === 0) {
      issues.push(`Season ${s.season_id} has games but no standings_snapshots row.`);
    } else if (rowCount > 1) {
      issues.push(`Season ${s.season_id} has ${rowCount} standings_snapshots rows — should be exactly 1.`);
    } else {
      const snapshotGames = gamesPlayedBySeason.get(s.season_id) ?? 0;
      const actualRegularGames = regularGamesBySeason.get(s.season_id) ?? 0;
      if (actualRegularGames > 0 && snapshotGames < actualRegularGames - 2) {
        issues.push(
          `Season ${s.season_id} standings snapshot shows ${snapshotGames} games played, but ${actualRegularGames} regular-season games are loaded — looks like a stale/incomplete snapshot.`,
        );
      }
    }
  }

  // Degraded names on this team's OWN roster — the exact bug this script
  // exists to catch early. A handful is expected (genuine mid-season
  // joiners not yet repaired); a large count means something's wrong.
  const { rows: degradedRows } = await client.query(
    `select count(*) as n from players p
     join player_team_seasons pts on pts.player_id = p.id
     where pts.team_id = $1 and p.full_name ~ '^[A-Za-z]\\. '`,
    [team.id],
  );
  const degradedCount = Number(degradedRows[0].n);
  if (degradedCount > 15) {
    issues.push(`${degradedCount} degraded players on this team's roster — higher than the expected handful, worth investigating.`);
  }

  // team_identities coverage — should have at least one row per season
  // range actually loaded (a real gap here means the identity-history
  // insert silently isn't firing for this team).
  const { rows: identityRows } = await client.query(
    `select count(*) as n from team_identities where team_id = $1`,
    [team.id],
  );
  if (Number(identityRows[0].n) === 0) {
    issues.push(`No team_identities rows at all for this team.`);
  }

  return { found: true, team, issues, degradedCount };
}

async function main() {
  const abbrev = process.argv[2];
  if (!abbrev) throw new Error("Usage: npx tsx scripts/verify-team.ts <ABBREV>");

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const result = await verifyTeam(client, abbrev);
  if (!result.found) {
    console.log(`No team found for abbrev ${abbrev}.`);
    await client.end();
    return;
  }

  console.log(`=== ${result.team!.name} (id ${result.team!.id}, ${abbrev}) ===`);
  console.log(`Degraded (abbreviated-name) players on this team's own roster: ${result.degradedCount}`);
  console.log();
  if (result.issues.length === 0) {
    console.log(`PASS — no issues found for ${abbrev}.`);
  } else {
    console.log(`FOUND ${result.issues.length} issue(s):`);
    for (const issue of result.issues) console.log(`  - ${issue}`);
  }

  await client.end();
  if (result.issues.length > 0) process.exit(1);
}

// Guarded so importing verifyTeam() elsewhere (scripts/checkpoint.ts)
// doesn't also trigger this file's own CLI run as an import side effect —
// found live: importing this file made it execute main() with whatever
// process.argv the IMPORTING script happened to have, printing this
// file's own CLI output using checkpoint.ts's argv by accident. Compares
// resolved real paths, not the raw strings — a naive import.meta.url vs.
// process.argv[1] string comparison fails whenever one side goes through
// a symlink (e.g. macOS's /tmp -> /private/tmp), which broke this exact
// guard the first time it was tried.
const isMainModule = process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
