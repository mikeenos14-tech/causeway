// Repair for a real data-quality bug found during Q&A stress testing
// (2026-09-17): scripts/backfill-season.ts's original upsert only ever set
// `updated_at` on conflict, so any player first inserted via the minimal
// box-score fallback (e.g. "B. Marchand", no birth_date) stayed stuck that
// way forever, even once a real bio became available in a later season's
// roster fetch. The upsert itself is fixed (see that file) — new backfills
// self-heal going forward. This repairs rows already corrupted by the old
// behavior, across ALL teams, not just Bruins.
//
// Originally Bruins-only; generalized once the same pattern (short-tenure
// players who never hit a roster snapshot) showed up on Anaheim and
// Buffalo too during the full-league rollout — worth fixing proactively
// across all 32 teams rather than accumulating it and doing one giant
// cleanup at the end.
//
// Usage: npx tsx scripts/repair-player-bios.ts

import { Client } from "pg";

const API = "https://api-web.nhle.com/v1";

// First run of the generalized (all-teams) version hit this hard: ~500
// sequential roster fetches plus up to ~2,000 individual player lookups
// with zero throttling drew 435 rate-limit (429) responses from the NHL
// API and left 937 players unrepaired. Retry with backoff instead of
// assuming a fixed "safe" delay is enough — self-adjusts to whatever the
// actual limit is instead of guessing.
async function fetchJson<T>(url: string, retries = 4): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json() as Promise<T>;
    if (res.status === 429 && attempt < retries) {
      const waitMs = 500 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    throw new Error(`${res.status} fetching ${url}`);
  }
  throw new Error(`Unreachable`);
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const { rows: degraded } = await client.query<{ id: number; abbrev: string; season_id: string }>(
    `select distinct p.id, t.abbrev, pts.season_id
     from players p
     join player_team_seasons pts on pts.player_id = p.id
     join teams t on t.id = pts.team_id
     where p.full_name ~ '^[A-Za-z]\\. '`,
  );

  if (degraded.length === 0) {
    console.log("No degraded player rows found — nothing to repair.");
    await client.end();
    return;
  }

  const teamSeasons = [...new Set(degraded.map((r) => `${r.abbrev}:${r.season_id}`))].sort();
  console.log(`Found ${degraded.length} degraded roster rows across ${teamSeasons.length} team-seasons. Fetching rosters...`);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const bioById = new Map<number, any>();
  for (const teamSeason of teamSeasons) {
    const [abbrev, seasonId] = teamSeason.split(":");
    try {
      const roster = await fetchJson<{ forwards: any[]; defensemen: any[]; goalies: any[] }>(
        `${API}/roster/${abbrev}/${seasonId}`,
      );
      for (const p of [...roster.forwards, ...roster.defensemen, ...roster.goalies]) {
        bioById.set(p.id, p);
      }
    } catch (err) {
      console.log(`  Skipping ${teamSeason}: ${err instanceof Error ? err.message : err}`);
    }
    await sleep(150);
  }

  const uniqueIds = [...new Set(degraded.map((r) => r.id))];
  let fixed = 0;
  let notFound: number[] = [];

  for (const id of uniqueIds) {
    let bio = bioById.get(id);
    if (!bio) {
      // Not on any of their teams' roster-season snapshots — likely a
      // mid-season trade-deadline pickup or brief call-up who joined and
      // left between snapshots (the documented "joined mid-season after a
      // roster snapshot" known gap). Fall back to that player's own
      // profile endpoint, which isn't tied to any single team-season.
      try {
        const landing = await fetchJson<any>(`${API}/player/${id}/landing`);
        bio = {
          firstName: landing.firstName,
          lastName: landing.lastName,
          positionCode: landing.position,
          shootsCatches: landing.shootsCatches,
          birthDate: landing.birthDate,
          birthCountry: landing.birthCountry,
          heightInCentimeters: landing.heightInCentimeters,
          weightInKilograms: landing.weightInKilograms,
        };
      } catch {
        // Genuinely unavailable — leave as-is, report below.
      }
      await sleep(150);
    }
    if (!bio) {
      notFound.push(id);
      continue;
    }
    const result = await client.query(
      `update players set
         full_name = $2, position = $3, shoots_catches = $4,
         birth_date = $5, birth_country = $6, height_cm = $7, weight_kg = $8,
         updated_at = now()
       where id = $1`,
      [
        id,
        `${bio.firstName.default} ${bio.lastName.default}`,
        bio.positionCode,
        bio.shootsCatches ?? null,
        bio.birthDate ?? null,
        bio.birthCountry ?? null,
        bio.heightInCentimeters ?? null,
        bio.weightInKilograms ?? null,
      ],
    );
    if ((result.rowCount ?? 0) > 0) fixed++;
    const done = fixed + notFound.length;
    if (done % 100 === 0) console.log(`  ${done}/${uniqueIds.length} processed (${fixed} fixed so far)`);
  }

  console.log(`Repaired ${fixed} of ${uniqueIds.length} degraded players.`);
  if (notFound.length > 0) {
    console.log(`Could not find a bio for ${notFound.length} player id(s) in any of their roster-season snapshots: ${notFound.join(", ")}`);
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
