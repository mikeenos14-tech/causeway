#!/bin/bash
# Runs backfill-season.ts across a range of seasons for one team.
# Usage: scripts/backfill-range.sh <teamAbbrev> <startYear> <endYear>
# e.g.   scripts/backfill-range.sh BOS 2007 2025   (covers the 2007-08 season
#        through the 2025-26 season, i.e. seasonIds 20072008..20252026)
#
# Continues past a season that fails (e.g. no schedule data, a transient
# API error) instead of aborting the whole range — failures are collected
# and reported at the end rather than silently swallowed.

set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
cd "$(dirname "$0")/.."

team="${1:?team abbrev required}"
start_year="${2:?start year required}"
end_year="${3:?end year required}"

failures=()

for year in $(seq "$start_year" "$end_year"); do
  season_id="${year}$((year + 1))"
  echo "=== ${team} ${season_id} ($((year - start_year + 1))/$((end_year - start_year + 1))) ==="
  if ! npx tsx scripts/backfill-season.ts "$team" "$season_id"; then
    echo "!!! FAILED: ${season_id}"
    failures+=("$season_id")
  fi
done

echo
echo "=== Range complete: ${team} ${start_year}-${end_year} ==="
if [ ${#failures[@]} -eq 0 ]; then
  echo "All seasons loaded successfully."
else
  echo "Failed seasons (rerun individually): ${failures[*]}"
fi
