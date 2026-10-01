# Golden games

Spec section 13: a fixed set of games with human-approved expected outputs, run on every model change. If a change moves one, the test fails until the owner approves the new value. **Status: game list approved by the owner 2026-10-01. Expected values are filled in as each model is built, then approved.**

Golden games are tests, not content. They overlap with the iconic list, but they also include deliberately boring games, since a model that gets excited about a dull 2-1 game is broken.

| # | Game | What it tests | Expected (spec where given; otherwise proposed) |
| --- | --- | --- | --- |
| 1 | 2013 Round 1 G7 vs TOR (5-4 OT) | WP, Leverage, Misery | Bruins WP low single digits at 4-1 in the third; ~50% at 4-4; Bergeron's tying goal near the top of single-game WPA; top-tier euphoria |
| 2 | 1970 Final G4 vs STL (4-3 OT, Orr) | Leverage, Cup Leverage | OT winner WPA 0.4–0.6; near the top of all-time Cup Leverage |
| 3 | 2011 Final G7 at VAN (4-0) | Misery/Euphoria, Cup Leverage | Highest euphoria of the modern era |
| 4 | 2019 Final G7 vs STL (1-4) | Misery | Top-3 misery game |
| 5 | 1979 SF G7 at MTL (4-5 OT) | WP, Misery, strength | Lafleur's power-play tying goal a large negative WPA for Boston; high misery |
| 6 | 2010 Round 2 G7 vs PHI (3-4) | WP, Misery | Peak Bruins WP very high at 3-0; one of the most painful losses |
| 7 | 2013 Final G6 vs CHI (2-3) | WP swing, Misery | Two goals 17 seconds apart produce the game's biggest swing; high misery |
| 8 | 1971 QF G2 vs MTL (5-7, led 5-1) | WP, Misery | Largest blown lead in the set; WP near certain then a loss |
| 9 | 2023 Round 1 G7 vs FLA (OT loss) | Elo, Misery | Boston heavy Elo favorite; high misery with the OT-loss bump |
| 10 | 2024 Round 1 G7 vs TOR (OT win) | Euphoria, Grudge | High euphoria; Toronto's heat toward Boston rises |
| 11 | 2004 Round 1 G7 vs MTL (0-2) | Misery stakes | High stakes but Boston never led: misery moderate, not top |
| 12 | 1990 Final G1 vs EDM (3OT loss) | WP in long OT | Overtime handled past one extra period |
| 13 | 1929-30 Bruins (38-5-1) | Elo | Among the franchise's top peak Elo seasons |
| 14 | 1970-71 and 1971-72 Bruins | Elo (spec acceptance) | Near the top of franchise history by peak Elo |
| 15 | 2022-23 Bruins (65 wins) | Elo, Misery | Top peak Elo of the modern era; season scores high in both misery and euphoria |
| 16 | 1988 Adams Final G5 vs MTL | Grudge | Boston's heat toward Montreal changes after 45 years of losses |
| 17 | BOS-TOR 2013/2018/2019/2024 | Grudge (spec smell test) | Toronto's heat toward Boston runs hotter than the reverse |
| 18 | A dull 2-1 regular-season game | Baseline | Small WPA swings; near-zero misery and euphoria |
| 19 | A 7-1 Bruins blowout, never trailed | Baseline | Near-zero euphoria (never in doubt); garbage goals under 0.02 WPA |
| 20 | A blowout loss, Bruins never led | Baseline (spec) | Near-zero misery |
| 21 | 1983-10-20 vs PHI (3-3 OT tie) | Ties | p_tie handled; first OT game in 40 years |
| 22 | 2013-04-17 vs BUF (shootout loss) | Shootout handling | Shootout model used; no shootout attempts counted as goals |
| 23 | 2026-09-29 opener vs NYR (Kastelic empty-netter) | Empty net | Empty-net goal WPA tiny |
| 24 | 1918 Wanderers forfeits | Data quality | Excluded from Elo |
| 25 | 1942-02-10 vs MTL (Kraut Line, 8-1) | Early-era data | Tier and era handled; no shots imputed as real |

Games 18–20 get specific game ids picked from the data once it's loaded (a typical game of each shape, not a cherry-picked one).
