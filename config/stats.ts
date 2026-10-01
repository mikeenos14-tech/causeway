// Every tunable setting for the Signature Stats engine lives here (spec
// section 2: "all tunable weights live in one config file"), never in the
// code that uses them. Phase 0 settings only so far; each later phase adds
// its own block.

// Eras (spec section 4) — the default grouping for era-adjusted stats.
// Config, not code: if WP calibration shows a boundary is wrong, move it here.
export const ERAS = [
  { id: "early", label: "Early", from: "19171918", to: "19421943" },
  { id: "original-six", label: "Original Six", from: "19431944", to: "19661967" },
  { id: "expansion", label: "Expansion", from: "19671968", to: "19821983" },
  { id: "high-scoring", label: "High Scoring", from: "19831984", to: "19921993" },
  { id: "dead-puck", label: "Dead Puck", from: "19931994", to: "20032004" },
  { id: "cap-shootout", label: "Cap and Shootout", from: "20052006", to: "20162017" },
  { id: "modern", label: "Modern", from: "20172018", to: "99999999" },
] as const;

export function eraOf(season: string): (typeof ERAS)[number] {
  return ERAS.find((e) => season >= e.from && season <= e.to) ?? ERAS[ERAS.length - 1];
}

// Regular-season overtime rules by season, for season_context.
export function otFormat(season: string): { label: string; shootout: boolean; tiesPossible: boolean } {
  if (season < "19281929") return { label: "varied (early era)", shootout: false, tiesPossible: true };
  if (season < "19421943") return { label: "10-minute overtime, not sudden death", shootout: false, tiesPossible: true };
  if (season < "19831984") return { label: "none (ties)", shootout: false, tiesPossible: true };
  if (season < "19992000") return { label: "5-minute sudden death, 5-on-5", shootout: false, tiesPossible: true };
  if (season < "20052006") return { label: "5-minute sudden death, 4-on-4", shootout: false, tiesPossible: true };
  if (season < "20152016") return { label: "5-minute 4-on-4, then shootout", shootout: true, tiesPossible: false };
  return { label: "5-minute 3-on-3, then shootout", shootout: true, tiesPossible: false };
}

export const DERIVED_MODEL_VERSION = "derived-v1";

// Franchise continuity. Starts from the NHL's own franchise ids
// (api.nhle.com/stats/rest/en/team) with two deliberate changes:
export const LINEAGE_OVERRIDES: { teamId: number; franchiseId?: number; lineageId: number; why: string }[] = [
  {
    // The NHL's team list files the original Winnipeg Jets (1979-96) under
    // the current Jets' franchise (Atlanta Thrashers, 1999). Wrong: the
    // original Jets moved to Phoenix in 1996 and became the Coyotes.
    teamId: 33,
    franchiseId: 28,
    lineageId: 28,
    why: "Original Winnipeg Jets (1979-96) became the Phoenix/Arizona Coyotes; the NHL list misfiles them with Atlanta.",
  },
  // Site decision (2026-10-01): Utah inherits Arizona's Elo and Grudge,
  // though the NHL treats Utah as a new franchise (40) and Arizona as
  // inactive. Both Utah identities (Hockey Club, then Mammoth) follow.
  { teamId: 59, lineageId: 28, why: "Utah Hockey Club inherits Arizona for Elo and Grudge (site decision)." },
  { teamId: 68, lineageId: 28, why: "Utah Mammoth inherits Arizona for Elo and Grudge (site decision)." },
];

// Stanley Cup Finals of 1918-1926 against other leagues' champions
// (PCHA/WCHL: Vancouver Millionaires, Seattle Metropolitans, Victoria
// Cougars...). The NHL feed lists them with non-NHL team ids (7000+); they
// aren't NHL-vs-NHL games, so they stay out of Elo, Grudge and every model.
export const EXCLUDE_NON_NHL_OPPONENTS = true;

// Data-quality tiers (spec section 4), assigned by the audit from what each
// game actually has, not from its season.
export const TIERS = {
  "A+": "Goal times, strength, empty net, shot events and on-ice counts (situation codes)",
  A: "Goal times with strength, and shots",
  B: "Goal times, partial or missing shots",
  C: "Period scores only",
  D: "Final score only",
} as const;

// NHL API politeness for the one-time backfill. The API is undocumented and
// rate-limits bursts (429s were hit during earlier backfills).
export const FETCH = {
  concurrency: 3,
  minIntervalMs: 120, // between request starts, across all workers
  maxRetries: 6,
  backoffMs: [2_000, 5_000, 10_000, 20_000, 40_000, 60_000],
} as const;
