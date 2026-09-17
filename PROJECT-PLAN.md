# Bruins Site — Starter Plan

Scaffolded but not yet built. This doc replaces a PROJECT-SUMMARY.md until there's
an actual build to summarize — write that once the site has real features, following
the same format as the Patriots (`Patriots Site/PROJECT-SUMMARY.md`) and Red Sox
(`Red Sox Analysis/PROJECT_SUMMARY.md`) docs.

## Why this stack

Matches **Foxboro Files** (the Patriots site), not Fenway Almanac (the Red Sox site):
Next.js 16 + React 19 + TypeScript + Tailwind v4, no database, JSON data committed
to `data/generated/`, Vercel hosting. Chosen deliberately over the Red Sox's
Python/FastAPI + vanilla-JS stack so that two of the three team sites share an
architecture — the realistic path toward eventually combining all three into one
app is a monorepo (`apps/patriots`, `apps/bruins`, shared `packages/ui` promoted
out of Patriots' existing primitives, shared `packages/data-core`), which only
works if the apps are already the same framework. That consolidation isn't being
built now — this is just architected so it doesn't block it later. Red Sox would
either stay a separately-hosted linked service or get ported at that time.

## Scaffold already in place

- `create-next-app` output: Next.js 16.3.5, React 19.2.8, TypeScript, Tailwind v4,
  App Router, ESLint — versions match Patriots exactly.
- Folder skeleton mirroring Patriots: `components/{shared,layout}`, `lib/{data,calc,util}`,
  `data/{generated,raw}`, `scripts/lib`, `scratch/`.
- `.gitignore` updated to exclude `/data/raw/` (regenerable fetch cache) and `/scratch/`
  (design mockups), matching Patriots' convention.
- Git not yet initialized — do that once there's a first real commit worth making.

## Planned architecture (to build feature-by-feature, not upfront)

- **Data pipeline**: standalone TS scripts run via `tsx`, `scripts/fetch-*.ts` →
  `data/raw/` (gitignored) → `scripts/build-*.ts` normalizes into typed shapes →
  `data/generated/*.json` (committed). Single read abstraction at `lib/data/store.ts`,
  same as Patriots.
- **AI writeups**: Claude API, same hard rule as both existing sites — grounded in
  real fetched/computed facts only, never free generation. Badge AI-written sections
  in the UI (Red Sox's convention).
- **Automation**: GitHub Actions, cadence split by how often reality actually changes
  (game-day-adjacent full refresh vs. more frequent news/injury polling) — same
  pattern as both existing sites' workflows.
- **Design**: reusable primitives (something like Patriots' `StatCard`/`RankBadge`/
  `TeamLogo`), full light/dark theme via CSS custom properties, mobile-first.
- Bruins colors: gold/black, no official NHL/Bruins logos or shield graphics
  (same trademark-avoidance rule as the Patriots site — original wordmark instead).

## Not yet decided — first things to research in the build session

- **NHL data source(s)**: nothing has been verified yet. Candidates to actually
  `curl` and check (schema, freshness, legality, no auth wall) before committing,
  same methodology as Patriots' source vetting: the NHL's own public API
  (`api-web.nhle.com`), MoneyPuck, Natural Stat Trick, and the Bruins' official site
  for news/practice reports. Don't trust this list — verify each one for real first.
- **Site sections**: likely Home, Recap, Next Game, Schedule, News, Roster & Stats,
  maybe a league-wide section — but follow the Patriots' actual working method
  (propose → user picks/adjusts → build) rather than speccing all of this upfront.
- **Branding name** — Patriots went "The Foxboro Beacon," Red Sox went through a
  couple names before landing on "The Fenway Almanac." Bruins name still open.
