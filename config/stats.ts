import type { EloParams } from "../lib/stats/elo";
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

// Elo (spec section 6). Starting values from the spec; build-elo.ts --tune
// grid-searches K, home ice, reversion and the margin coefficient on the
// training seasons and prints the winners to paste here. The model version
// changes whenever these do.
export const ELO = {
  // Tuned 2026-10-02 on 1917-2027 training seasons (every fifth season held
  // out): training log loss 0.65841 vs 0.66033 for the spec's starting
  // values. Every value is inside its search range (margin first landed on
  // the old range's edge, so the range was widened and re-run).
  modelVersion: "elo-v1.1-2026-10-02",
  params: {
    initial: 1500,
    expansionStart: 1380,
    leagueMean: 1505,
    kRegular: 5,
    kPlayoff: (5 * 4) / 3,
    homeIce: { early: 70, "original-six": 70, expansion: 80, "high-scoring": 60, "dead-puck": 30, "cap-shootout": 30, modern: 20 } as Record<string, number>,
    marginCoef: 1.25,
    reversion: 0.4,
    otWinnerScore: 0.75,
    // Adopted 2026-10-02 from scripts/stats/experiment-elo.ts (held-out,
    // game-by-game against the v1 settings): margins leave out the winner's
    // empty-net goals where known (2009-10 on), +0.00038 log loss, 2.9 SE;
    // a team on the second night of a back-to-back plays 30 points below
    // its rating, +0.00131, 3.5 SE (tuned 0-60). Tested and rejected:
    // autocorrelation damping, separate shootout scoring, early-season K
    // (1.2 SE).
    marginExcludesEmptyNet: true,
    b2bPenalty: 30,
  } as EloParams,
  // Pregame win chance (OT and shootouts count as wins) from the pregame
  // rating gap incl. era home ice and the back-to-back penalty:
  // p = 1 / (1 + exp(-(intercept + slope * gap))). Fitted by
  // scripts/stats/calibrate-elo-winprob.ts on 2005-06 on training seasons
  // (20,464 games) with the v1.1 ratings; on the held-out seasons (4,854
  // games) log loss 0.6722 vs 0.6882 for the no-skill baseline, Brier
  // 0.2398 vs 0.2475, average calibration error 2.3 points. Refit whenever
  // the Elo parameters change. Regular season only.
  winProb: { intercept: 0.014, slope: 0.005664, calibrationErrorPts: 2.3, heldOutGames: 4854 },
  // Games that aren't real results: the 1918 Montreal Wanderers forfeits
  // (their arena burned down; Montreal and Toronto were credited 1-0 wins).
  excludeGameIds: [1917020035, 1917020036],
};

// Spec section 13: hold out every fifth season (those ending in 0 and 5)
// for calibration checks; never tune on them.
export const isHeldOutSeason = (season: string) => ["0", "5"].includes(season.slice(-1));

// Grudge Index (spec section 9): each event adds heat that halves every
// half-life; a franchise's heat toward another is the sum. Weights and
// half-lives are the spec's V1 judgment calls, not fitted (V2 calibrates
// them against later penalties and fights). Readings of the spec's table:
//  - fight: 3 per fight (two fighting majors), both directions
//  - game misconduct / match / gross misconduct: 4 each, from the team the
//    penalty was against (the wronged side) toward the penalized team
//  - lost a 3+ goal lead: only when the game was lost; a comeback game
//    also gives the winner 5 (pride) and the loser +3, as the spec lists
//  - one-goal games include ties and every OT/shootout game
//  - same division: once per season, dated at the season's last game
export const GRUDGE = {
  modelVersion: "grudge-v1-2026-10-05",
  events: {
    playoffSeries: { weight: 20, halfLifeYears: 6 },
    eliminated: { weight: 25, halfLifeYears: 10 },
    gameSeven: { weight: 10, halfLifeYears: 10 },
    fight: { weight: 3, halfLifeYears: 2 },
    ejection: { weight: 4, halfLifeYears: 2 },
    excessPim: { weight: 0.2, halfLifeYears: 1 }, // per minute above the season's average game
    closeGame: { weight: 1.5, halfLifeYears: 1 },
    blownLead: { weight: 7, halfLifeYears: 4 },
    comebackWinner: { weight: 5, halfLifeYears: 3 },
    comebackLoser: { weight: 3, halfLifeYears: 3 },
    regularMeeting: { weight: 0.5, halfLifeYears: 1 },
    sameDivision: { weight: 4, halfLifeYears: 3 },
  },
  blownLeadGoals: 3,
};
export type GrudgeEventType = keyof typeof GRUDGE.events;
