# Signature Stats: spec-to-build map

Every item in the *Bruins App Signature Stats Build Spec* (Oct 1, 2026), with its status, where it lives, the data behind it, and any deliberate deviation. Updated as work lands. Status: **Done** · **Built** (code done, waiting on full data or tuning) · **In progress** · **Planned** · **Changed** (built differently from the spec, reason given) · **Deferred** · **Cut** (proposed; needs owner sign-off) · **Blocked** (needs data or infrastructure we don't have).

Owner decisions so far (2026-10-01): history back to **1917**; Utah inherits Arizona for Elo and Grudge; live mode for **all games**; iconic list approved with a deep dive; foundations at full-build level, features at V1 then upgraded.

## Data availability (verified against the NHL feed, not assumed)

| Need | Available? | Where from | Notes |
| --- | --- | --- | --- |
| Final scores, every game since 1917-18 | Yes | stats API game list (70,360 finished games) | 43 pre-1927 Cup Finals vs other leagues excluded (non-NHL opponents) |
| Goal times, scorers, assists | Yes, back to 1917 | play-by-play | 75/75 sampled games 1917–2006 add up to the final score |
| Goal strength (PP/SH) | Yes, decades back | landing summary | Real flags from the 1920s per the audit; exact on-ice counts from 2009-10 |
| Empty-net flags | 2009-10 on (exact) | situation codes | Unknown (null) before; never guessed |
| Penalties with type, minutes, player | Yes, back to 1917 | play-by-play | Includes fighting, misconducts, match penalties |
| Shots on goal, game totals | Mid-1950s on | play-by-play | Per-period and shot events from about 2005-06 |
| On-ice manpower (situation codes) | 2009-10 on | play-by-play | Basis for manpower and goalie intervals |
| Shifts | 2010-11 on | shiftcharts API | Too big for the free database (≈13M rows); not planned |
| Goalie per game (who played, started, decision) | Yes, historical | boxscore | Queued after the main backfill; loader built (`nhl_goalie_games`) |
| Standings by date, divisions, conferences | Yes, historical | standings/{date} | Queued after the boxscores; loader built (`nhl_standings`) |
| Venue name and city | Yes | play-by-play | Coordinates must be curated (Legs only) |
| Transactions (trades, signings) | **No free source found** | — | Blocks Elo roster shock and Grudge transactions |
| Betting odds | No | paid | Blocks Legs betting view |
| User accounts | **No auth on the site** | — | Blocks personal meter, fan voting, fan pulse, notifications |

## Section 2: build rules

| Rule | Status | Notes |
| --- | --- | --- |
| model_version + computed_at on every computed value | Done | All derived and Elo tables |
| Sample size / confidence field on every stat | Planned | Per feature; n<30 "small sample", n<10 hidden (section 12) |
| All weights in one config file | **Changed** | `config/stats.ts` (typed TypeScript) instead of `stats.yaml`; same purpose, checked by the compiler |
| One rebuild command per model | In progress | Scripts exist (`scripts/stats/build-*.ts`); add `npm run rebuild:*` aliases |
| Each phase's tests pass before the next | In progress | Elo tests written; full-history acceptance runs after the backfill |

## Section 3: platform and Live Game Mode

| Item | Status | Notes |
| --- | --- | --- |
| Batch: ingest_finals | Done | Hourly (not 4 AM + 15 min after final): new finals + 48-hour re-check for scoring changes |
| Batch: rebuild_derived | Done | Daily job |
| Batch: update_elo | Done | Daily job rebuilds Elo and runs `verify-elo-sql.ts` |
| Batch: update_wp_tables (weekly), update_wpa_ledger, update_grudge, update_misery, update_legs, rebuild_similarity_index | Planned | With their phases |
| Idempotent jobs | Done | Every builder rebuilds from scratch or replaces per game |
| Feed adapter module | Done | `lib/live-game.ts` (live scoreboard branch) |
| Poller lifecycle cadences (5 min / 60 s / 10 s / 30 s / final + 30 min) | **Changed** | No always-on server on Vercel. Values are computed on request from the feed, edge-cached 10–15 s; clients poll. Same freshness, no poller |
| Live state store (Redis) | **Changed** | Not needed under compute-on-request; live values are pure functions of (events, clock) as the spec requires |
| Server-Sent Events push | **Changed** | Client polling every 15–20 s (the spec's own fallback); SSE on serverless is limited by function duration |
| Clock interpolation between polls | Planned | Phase 2 |
| Corrections: recompute from full event list, "goal under review/overturned" note | Planned | Recompute is automatic (stateless); the overturned-goal note needs the previous event list client-side |
| Failure handling, "live data delayed" after 60 s | Partly done | Scoreboard shows "reconnecting"; add the 60-second delayed label |
| Live mode for all games | Done (scoreboard) | Owner decision |
| App API: /api/live/{id} | Built | Scoreboard version; extended with WP, Doppelganger, Misery in Phase 2+ |
| App API: stream, wp, doppelganger, leverage (game/player/leaderboard), elo, timemachine, grudge (pair/top), misery, legs | Planned | With their features |

## Section 4: shared data layer

| Item | Status | Where |
| --- | --- | --- |
| games | Done | `nhl_games` (separate from the site's `games` on purpose) |
| period_scores | Done | `nhl_period_scores` (shots from shot events only) |
| goal_events | Done | `nhl_goal_events` |
| penalty_events | Done | `nhl_penalty_events` |
| playoff_series | Planned | Derive from playoff game ids (round/series/game digits) |
| franchises / teams | Done | `nhl_franchises`, `nhl_teams.lineage_id` (two corrections in config) |
| venues | Planned | Name + city from the feed; coordinates curated (Legs only) |
| players | Done | `nhl_players` from game rosters |
| manpower_intervals, goalie_intervals | Planned | From 2009-10 situation codes (cached raw feed) |
| shot_events | Planned | Shots on goal 2005-06 on; storage check first |
| player_game_toi | Changed | Site's box-score TOI covers 2007-08 on; no shift counts |
| iconic_games | In progress | 79 curated, verified against data before storing; plus data-mined candidates |
| season_context | Done | `season_context` |
| game_state_snapshots | Done | Shots exact at period ends; P3 mid-period shots wait on shot events |
| team_rest | Done (travel pending) | Travel needs venue coordinates |
| Eras as config | Done | `ERAS` in config |
| Data-quality tiers + audit script | Done | `scripts/stats/audit.ts` |
| Franchise mapping incl. Utah decision | Done | `LINEAGE_OVERRIDES` |
| Extra: game_labels (names for every notable game) | Done | Not in the spec; makes Doppelganger's featured card always nameable |
| Extra: historical standings, goalie per game | Done | `nhl_standings` (1,774/1,774 team-seasons match the NHL's final standings), `nhl_goalie_games` |
| Extra: historical box scores | Done | `nhl_skater_games` (1.55M rows, checked against play-by-play; played/not from game logs; 30,519/30,521 player-seasons match official totals) |
| Extra: "This day in Bruins history" | Done | Home page; facts only from verified data |

## Section 5: Win Probability

| Item | Status | Notes |
| --- | --- | --- |
| V1 table: (era, goal_diff, minute) with logistic blend, n/(n+200) | **Built** | Poisson base by era + correction table (era x reg/playoff x minute x margin +/-3), weight pooled over 5 minutes; held out: log loss 0.475, calibration 0.44 pts (wp-v1-2026-10-02) |
| Ties: p_win and p_tie separately | **Built** | Chart plots win + tie/2 in tie eras |
| OT and shootout rates by era; playoff OT only | **Built** | Rates per OT rule; 1928-42 ten full minutes; 1983-2005 tied OT decays toward a tie |
| Monotonicity enforcement | **Built** | 2D isotonic on the table; tested over 9,240 states |
| Live: jump on goals, drift per minute, Bruins' side | **Built** | /api/live + scoreboard; replay-tested on 3,176 recorded responses (scripts/stats/test-live-wp.ts) |
| UI: live chart, biggest swing, historical game charts | **Built** | Live chart on the game page, win-chance bar on the home hero |
| V2 manpower state | Planned | 2009-10 on (situation codes) |
| V2 empty net | Planned | 2009-10 on |
| V2 team strength (Elo) | **Built** | kappa 0.003 fitted on training seasons; beats no-strength 0.475 vs 0.490 log loss |
| V2 pressure term | Planned | Shot events 2005-06 on |
| V2 final-minute 10-second buckets | Planned | |
| V2 OT/shootout model from Elo | Planned | |
| V2 uncertainty band | Planned | |
| Full build: LightGBM classifier | **Cut (proposed)** | Adds Python to the stack for a small gain over the V1 table + V2 terms; revisit if calibration fails |
| Acceptance: calibration, Brier vs baseline, monotonic, 2013 G7 smell test, goal-to-screen < 20 s | Planned | |

## Section 6: Elo and the Time Machine

| Item | Status | Notes |
| --- | --- | --- |
| V1 Elo (formulas, parameters, reversion, expansion, league mean) | Done (v1.1) | `lib/stats/elo.ts`. v1.1 (2026-10-02): margins without empty-net goals, 30-point back-to-back penalty, both adopted on held-out evidence; autocorrelation damping, separate shootout scoring and early-season K tested and rejected (`scripts/stats/experiment-elo.ts`). Every expectation and every rating change recomputed independently in SQL (`verify-elo-sql.ts`) |
| Tuning script (grid search, per-era log loss) | Built | Tunes on training seasons only; every fifth season held out |
| elo_history / elo_current | Built | Migration 0015 |
| Forfeits excluded | Done | 1918 Wanderers forfeits |
| Time Machine: franchise rankings | Done (Bruins) | `/history/elo`: every Bruins season by peak, average or final Elo, with record and result (2026-10-02) |
| Time Machine: series simulator | Built (engine) | Seeded 2-2-1-1-1 simulator, ms for 10,000 series; UI planned |
| Time Machine: twin team | Planned | |
| Pregame Elo odds on previews | Done | Win chance from the Elo gap + era home ice (`config ELO.winProb`, `lib/elo-odds.ts`); held-out log loss 0.6737 vs 0.6882, calibration error 2.7 pts; owner chose whole % with a "How this works" note (2026-10-02) |
| V2 goalie adjustment | Planned | Needs historical goalie-per-game fetch |
| V2 roster shock | **Blocked** | No transactions source; manual nudges possible |
| V2 era-neutral box score sim | Planned | |
| V2 custom matchups + share cards | Planned | |
| V2 Elo playoff odds | Planned | Current playoff format only (spec allows) |
| Acceptance: log loss vs baseline per era, 1970s Bruins top, mean ±5, deterministic, sim < 1 s | Built | Three pass now; two run on full history |

## Section 7: Doppelganger Game

| Item | Status | Notes |
| --- | --- | --- |
| Checkpoints + candidate pool from snapshots | Partly done | Snapshots built; needs WP and Elo diff |
| Feature vector, hard filters, weighted distance, 200/25 neighbors | Planned | |
| Fame score + featured card | In progress | Curated list, mined candidates, auto labels |
| Next-goal branch | Planned | |
| In-memory buckets, < 50 ms | Planned | |
| Postgame twin, copy templates file | Planned | |
| doppelganger_results storage | Planned | |
| V2 manpower/empty-net features | Planned | 2009-10 on |
| V2 continuous matching, sequence (DTW) matching | Planned | |
| V2 story generator (Claude) | Planned | Reuse the grounded-recap pattern: fact sheet + validators |
| V2 fan-tagged fame | **Blocked** | No accounts |
| V2 "what if" mode | Planned | |
| Acceptance: odds vs WP within 5, same score/period, < 50 ms p95, 2013 smell test | Planned | |

## Section 8: Leverage Goals

| Item | Status | Notes |
| --- | --- | --- |
| WPA per goal, OT goals, playoff stakes, assist credit | **Built** | 425,363 goals in 70,292 games; stakes from Elo + binomial; total-goals and irregular series get no stakes (scripts/stats/build-leverage.ts) |
| Player metrics (LG, per goal, garbage %, assist, playoff, era-adjusted) | **Built** (Changed) | Era adjustment is per season (league average WPA per goal in the seasons he scored), finer than eras. Shown as "wins added", not "clutch" |
| goal_wpa / player_leverage storage | **Built** | Plus leverage_games (per-game reconciliation); goal_wpa kept lean (DB near plan limit) |
| Live WPA badge, Biggest Goal of the Night | **Built** | Badge on the live goal list; "Biggest goal" marked in the scoring summary and chart |
| UI: leaderboards, clutch card, Bruins top 50 | **Built** | /history/leverage, /history/leverage/league, player card |
| V2 Cup Leverage | Planned | Next; needs a rule for future-round opponents (owner decision) |
| V2 manpower-aware WPA | Planned | |
| V2 goalie save leverage | Planned | Shot events with outcomes, 2009-10 on |
| V2 leverage for early eras (estimated times) | **Not needed** | Real goal times exist back to 1917 |
| V2 clutch vs expected | Planned | |
| Acceptance: WPA + drift reconciles, OT winners 0.4–0.6, Orr/2011/Bergeron smell tests, badge < 20 s | Partial | Reconciles in all games; sudden-death OT winners 90% within 0.35-0.65; Bergeron 2013 #1 Bruins playoff goal. Orr 1970 ranks low by design (series 97% decided; see notes); 2011 needs Cup Leverage; badge timing measured on the first live game |

## Section 9: Grudge Index

| Item | Status | Notes |
| --- | --- | --- |
| Event heat with half-lives, directional | Planned | Penalty events and playoff results loaded |
| Same-division event | Planned | Needs historical standings fetch |
| Monthly percentile scaling, reasons text | Planned | |
| grudge_events / monthly / current storage | Planned | |
| Live provisional events | Planned | |
| UI: thermometer, timeline, hottest, cold wars, two-way gauge | Planned | |
| V2 player grudges | Planned | Penalty player ids available |
| V2 transactions | **Blocked** | No source |
| V2 calibration from behavior | Planned | Recommended: makes the weights defensible |
| V2 fan pulse, notifications | **Blocked** | No accounts or push |
| Acceptance: non-negative, 20-year decay, asymmetry, Montreal/Toronto smell tests | Planned | |

## Section 10: Misery and Euphoria

| Item | Status | Notes |
| --- | --- | --- |
| Game misery/euphoria from max/min WP, stakes, rivalry | Planned | Needs WP, Grudge; Elo fallback rarely needed (goal times everywhere) |
| Multipliers incl. "final 15 games within 4 points of a playoff spot" | Planned | Needs historical standings fetch |
| Season events incl. "first-round exit as division winner or top seed" | Planned | Needs standings/seeding |
| Storage, live meter, Scar List, Joy List, season rankings | Planned | |
| V2 personal meter | **Blocked** | No accounts |
| V2 narrative events | Planned | Curation by owner |
| V2 streak pain, hope decay, league-wide comparison | Planned | |
| Acceptance: blowout near-zero, max bounds, 2013/2011/2019/1979 smell tests, season ranking | Planned | |

## Section 11: Legs Score

| Item | Status | Notes |
| --- | --- | --- |
| Rest, back-to-back, load, road trip, homestand return | Done (data) | `team_rest` |
| Travel miles, rolling travel, time zones, altitude | Planned | Needs curated venue coordinates |
| Logistic model, fade model, trap game flag, storage, UI | **Deferred (proposed)** | Effect is ~2–3 points of win chance and noisy; build last or cut |
| V2 player load | Changed | TOI exists 2007-08 on only |
| V2 goalie fatigue | Planned | Needs goalie-per-game fetch |
| V2 betting view | **Blocked** | Odds data is paid |

## Section 12: shared UI and content

| Item | Status | Notes |
| --- | --- | --- |
| Game-day screen by phase | Planned | Builds on the live scoreboard |
| Share cards 1200×630 | Done for game links | Extend to Doppelganger, Biggest Goal, Grudge, Scar List, Time Machine |
| Share cards 1080×1350 (social) | Planned | |
| Sample-size labels (n<30 small sample, n<10 hidden) | Planned | |
| "Estimated" tags | Mostly not needed | Real goal times everywhere; still needed for imputed shots in old games |
| "How this works" panels | Planned | |
| Copy templates file | Planned | |
| Copy rules (Bruins' side, whole %, signed WPA, playful vs straight) | Planned | |
| Visual conventions, static chart rendering | Planned | |
| Animation: goal light on the live scoreboard | In progress | Owner-approved 2026-10-01, for the Oct 2 game; no sound |
| Animation: WP chart draws itself, swings labeled | Planned | Ships with WP (section 5) |
| Animation: Cup banners in the rafters (history page) | Planned | Ships with the history features |
| Animation: Time Machine series revealed game by game | Planned | Ships with the Time Machine (section 6) |
| Animation: Doppelganger card flip reveal | Planned | Ships with Doppelganger (section 7) |
| Animation rules | Standing | Mark moments, never decorate; honor reduced motion; never delay the information |

## Section 13: testing and validation

| Item | Status | Notes |
| --- | --- | --- |
| Unit tests | In progress | Parser (26) and Elo (16) pass |
| Invariant tests | In progress | Elo mean and zero-sum done; WP/heat/WPA later |
| Calibration (held-out seasons) | Built for Elo | |
| Smell tests | In progress | 1970s Bruins Elo runs on full history |
| Live replay harness | In progress | Recording 8 real games tonight; harness itself is Phase 2 |
| Performance tests | In progress | Series sim done |
| Correction tests (overturned goal) | Planned | Needs a recorded overturned goal, or a synthetic one |
| Validation split (every fifth season held out) | Done | `isHeldOutSeason` |
| Golden games fixtures | In progress | 25-game list approved 2026-10-01 (docs/golden-games.md); values approved per model as built |
