#!/bin/bash
# Runs backfill-range.sh across every remaining NHL team. Bruins (BOS) and
# the Phoenix/Arizona/Utah Coyotes lineage are already loaded (backfilled
# and verified 2026-09-17) — not included here.
#
# Continues past a team that fails entirely instead of aborting the whole
# rollout — failures are collected and reported at the end, the same
# "continue past failures, report at the end" pattern backfill-range.sh
# already uses one level down, for seasons within a team.
#
# Three teams need special handling, not the standard 2007-2025 range:
#  - Vegas Golden Knights (VGK): franchise didn't exist before 2017-18.
#  - Seattle Kraken (SEA): franchise didn't exist before 2021-22.
#  - Winnipeg Jets: this franchise slot used a different team id as the
#    Atlanta Thrashers (2007-08 through 2010-11) before relocating in 2011
#    — confirmed directly against the live API, same pattern as the
#    Phoenix/Arizona/Utah pilot. Run as two separate ranges.

set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
cd "$(dirname "$0")/.."

# abbrev:startYear:endYear, one per line.
entries=(
  "ANA:2007:2025" "BUF:2007:2025" "CAR:2007:2025" "CBJ:2007:2025"
  "CGY:2007:2025" "CHI:2007:2025" "COL:2007:2025" "DAL:2007:2025"
  "DET:2007:2025" "EDM:2007:2025" "FLA:2007:2025" "LAK:2007:2025"
  "MIN:2007:2025" "MTL:2007:2025" "NJD:2007:2025" "NSH:2007:2025"
  "NYI:2007:2025" "NYR:2007:2025" "OTT:2007:2025" "PHI:2007:2025"
  "PIT:2007:2025" "SJS:2007:2025" "STL:2007:2025" "TBL:2007:2025"
  "TOR:2007:2025" "VAN:2007:2025" "WSH:2007:2025"
  "ATL:2007:2010" "WPG:2011:2025"
  "VGK:2017:2025"
  "SEA:2021:2025"
)

failures=()
total=${#entries[@]}
i=0

for entry in "${entries[@]}"; do
  i=$((i + 1))
  IFS=':' read -r abbrev start end <<< "$entry"
  echo
  echo "########## [$i/$total] $abbrev $start-$end ##########"
  if ! bash scripts/backfill-range.sh "$abbrev" "$start" "$end"; then
    echo "!!! TEAM FAILED: $abbrev $start-$end"
    failures+=("$abbrev:$start-$end")
  fi
done

echo
echo "=== Full rollout complete ==="
if [ ${#failures[@]} -eq 0 ]; then
  echo "All teams loaded successfully."
else
  echo "Failed team ranges (rerun individually): ${failures[*]}"
fi
