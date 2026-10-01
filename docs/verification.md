# Signature Stats verification protocol

Owner requirement (2026-10-01): every feature is tested exhaustively and its math independently double-checked before anything ships. A plausible-looking wrong number costs more trust than a delay. No feature is called done until every layer below has passed, and the owner sees a short verification report with the actual numbers.

## The layers, for every model

1. **Hand-worked unit cases.** Every formula is tested against numbers worked out by hand, with the arithmetic written in the test (e.g. equal ratings with 50 home ice: E = 1/(1+10^(-50/400)) = 0.5715).
2. **A second, independent computation.** Key outputs are recomputed by a different code path (usually plain SQL against the raw tables) and must match the engine: e.g. WP cell counts recounted straight from goal events; season Elo means recomputed from elo_history; WPA totals re-summed. Two implementations agreeing is much stronger evidence than one implementation passing its own tests.
3. **Invariants on every row, not samples.** Rules that must always hold: Elo updates are zero-sum and the league mean stays at 1505; WP rises with goal differential; heat is never negative; WPA plus clock drift reconciles to the final result.
4. **Held-out calibration, with the margins reported.** Tuned on training seasons only; every fifth season held out. Reliability tables by 10% bucket and log loss / Brier against a baseline, per era, reported with how much the model beats the baseline, not just whether it does. A thin margin in an era softens what the UI claims for that era.
5. **Golden games.** The 25 owner-approved games (docs/golden-games.md) with owner-approved expected values; any change that moves one fails until re-approved.
6. **External reconciliation.** Our data and outputs are checked against official or published numbers wherever they exist:
   - each team-season's goals for/against and record vs the NHL's own standings;
   - Stanley Cup winners vs our computed Cup clinchers;
   - every curated iconic game vs its sources and the data (already enforced by verify-iconic-games);
   - model outputs vs well-known history (the best teams of each era near the top of Elo; famous comebacks at the bottom of the WP chart).
7. **Edge cases, deliberately.** Ties and the eras that allowed them; forfeits; shootouts; five-overtime games; empty-net goals; overturned goals (live); relocations and the Utah lineage; expansion seasons; the 2004-05 lockout, the 48-game 2012-13 season, the 2019-20 pause and bubble, the 56-game 2020-21 season.
8. **Hand-traced spot checks.** A random sample of outputs is traced by hand from the raw NHL feed through every step to the number on screen.
9. **Verification report to the owner.** Each feature ships with a short table: what was checked, the actual numbers, anything that failed and what was done about it, and any era or situation where the feature is weaker and how the UI says so.

## Status by feature

| Feature | 1 Unit | 2 Second computation | 3 Invariants | 4 Calibration | 5 Golden | 6 Reconciliation | 7 Edge cases | 8 Spot checks | 9 Report |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Phase 0 data layer | Parser 26 checks | Audit vs site games table | Goals add up to finals | — | — | Standings: built, 56/56 team-seasons match so far | Forfeits, non-NHL Finals, ties, shootouts | Famous games traced | After full load |
| Elo | 16 checks | Planned | Zero-sum, mean | Built | Planned | Planned | Partly | Planned | Planned |
| WP, Leverage, Misery, Doppelganger, Grudge, Legs | Planned | Planned | Planned | Planned | Planned | Planned | Planned | Planned | Planned |
