#!/bin/bash
# Keeps the CURRENT NHL season fresh across the whole league — the
# recurring counterpart to backfill-all-teams.sh's one-time historical
# rollout. Meant to run frequently (see .github/workflows/refresh-data.yml)
# during the season: games/standings for all 32 teams, then special-teams
# stats and Bruins narratives, in that order since the later two depend on
# game data already being loaded.
#
# Cheap to run often because backfill-season.ts now skips any game it's
# already loaded (added specifically for this) — a run with nothing new
# to fetch finishes in seconds per team, not minutes.
#
# Continues past a team that fails (e.g. no completed games yet, early in
# the preseason — every team will legitimately fail this way until the
# first game of the season is actually played) instead of aborting the
# whole run, same pattern as backfill-all-teams.sh.

set -uo pipefail
cd "$(dirname "$0")/.."

# The 32 currently active teams (is_active = true in the database) —
# hardcoded rather than queried at runtime so this script has no DB
# dependency before it even starts; update this list if a team relocates
# or rebrands (matches how backfill-all-teams.sh already handles that).
teams=(
  ANA BOS BUF CAR CBJ CGY CHI COL DAL DET EDM FLA LAK MIN MTL NJD NSH
  NYI NYR OTT PHI PIT SEA SJS STL TBL TOR UTA VAN VGK WPG WSH
)

# NHL seasons run roughly October-June but preseason starts mid-September
# — treating September as the season's own first month catches preseason
# games too, not just once the regular season opens.
season_id=$(node -e '
  const now = new Date();
  const y = now.getUTCFullYear();
  const startYear = now.getUTCMonth() >= 8 ? y : y - 1; // getUTCMonth() is 0-indexed; 8 = September
  console.log(`${startYear}${startYear + 1}`);
')
echo "=== Refreshing season ${season_id} ==="

failures=()
for team in "${teams[@]}"; do
  echo
  echo "--- ${team} ${season_id} ---"
  if ! npx tsx scripts/backfill-season.ts "$team" "$season_id"; then
    echo "!!! ${team} failed (expected before the season's first completed game)"
    failures+=("$team")
  fi
done

echo
echo "=== Games/standings pass complete: ${#failures[@]} of ${#teams[@]} teams had nothing to load ==="

echo
echo "=== Special-teams / faceoff stats (league-wide, incremental) ==="
npx tsx scripts/backfill-team-game-stats.ts

echo
echo "=== Bruins narratives (incremental) ==="
npx tsx scripts/generate-highlights.ts

echo
echo "=== Refresh complete ==="
