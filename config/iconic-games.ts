// Curated fame for the Doppelganger Game (spec section 7): the games a
// die-hard knows by name. Each entry identifies its game structurally
// (playoff series + game number, or a regular-season date + opponent),
// and carries claims that scripts/stats/verify-iconic-games.ts checks
// against the loaded history before the row is trusted. An entry whose
// claims don't match the data is rejected, never stored on faith.
//
// Weights (1-10): 10 = franchise-defining, 7-9 = every fan knows it,
// 4-6 = cult classics and rivalry nights. Pain counts as much as glory:
// "this looks like 2010 in Philly" lands as hard as "this looks like 2011".
// Curated by: the site owner (approved list, 2026-10-01), drafted by Claude.

export type IconicEntry = {
  team: string; // whose game it is, usually BOS
  opp: string; // opponent tri-code as the NHL lists it that season ("*" = whoever they played that date)
  season: string; // '19691970'
  playoffGame?: number; // game N of that season's playoff series vs opp
  date?: string; // 'YYYY-MM-DD' (local game date), any game type
  // False for games remembered because someone was badly hurt: kept as
  // history, never shown as a featured Doppelganger twin.
  featurable?: boolean;
  sources?: string[]; // where a web-researched entry came from
  label: string;
  story: string;
  weight: number;
  category: "mythic" | "famous" | "cult" | "league";
  expect: {
    teamScore?: number;
    oppScore?: number;
    won?: boolean;
    ot?: boolean; // ended in overtime (not a shootout)
    otPeriods?: number;
    shootout?: boolean;
    lastGoalBy?: string; // last name of the final goal's scorer
    scoredBy?: string[]; // last names who must have scored in the game
    trailedBy?: number; // team trailed by at least this many at some point
    ledBy?: number; // team led by at least this many at some point
  };
};

const BRUINS_TOP10 = "https://www.nhl.com/news/top-10-moments-in-boston-bruins-history";
const ERA_1924 = "https://www.nhl.com/bruins/news/the-early-years-top-10-moments-from-1924-59";
const ERA_1960 = "https://www.nhl.com/bruins/news/the-big-bad-bruins-top-10-moments-from-1960-76";
const ERA_1977 = "https://www.nhl.com/bruins/news/the-lunch-pail-a-c-top-10-moments-from-1977-85";
const ERA_1986 = "https://www.nhl.com/bruins/news/new-blood-new-beginnings-top-10-moments-from-1986-2000";
const ERA_2001 = "https://www.nhl.com/bruins/news/return-of-a-champion-top-10-moments-from-2001-present";
const REG_SEASON = "https://causewaycrowd.com/5-most-memorable-regular-season-games-in-bruins-history";

export const ICONIC_GAMES: IconicEntry[] = [
  // ---- Cups and Finals ----------------------------------------------------
  { team: "BOS", opp: "NYR", season: "19281929", playoffGame: 2, label: "The first Cup", story: "Boston clinches its first Stanley Cup at Madison Square Garden in the first all-American Final.", weight: 8, category: "famous", expect: { won: true } },
  { team: "BOS", opp: "TOR", season: "19381939", playoffGame: 5, label: "1939 Cup clincher", story: "The Bruins finish off Toronto for the franchise's second Stanley Cup.", weight: 7, category: "famous", expect: { won: true } },
  { team: "BOS", opp: "DET", season: "19401941", playoffGame: 4, label: "1941 Cup sweep", story: "Boston sweeps Detroit for a third Stanley Cup, the last for 29 years.", weight: 7, category: "famous", expect: { won: true } },
  { team: "BOS", opp: "STL", season: "19691970", playoffGame: 4, label: "Orr's flying goal", story: "Bobby Orr scores 40 seconds into overtime and flies across the crease. The Bruins' first Cup in 29 years.", weight: 10, category: "mythic", expect: { won: true, ot: true, lastGoalBy: "Orr", teamScore: 4, oppScore: 3 } },
  { team: "BOS", opp: "NYR", season: "19711972", playoffGame: 6, label: "1972 Cup at the Garden in New York", story: "Orr scores the winner and Boston shuts out the Rangers to win the Cup on Madison Square Garden ice.", weight: 10, category: "mythic", expect: { won: true, oppScore: 0 } },
  { team: "BOS", opp: "PHI", season: "19731974", playoffGame: 6, label: "Parent and the Flyers", story: "Bernie Parent shuts Boston out 1-0 and the Flyers win the Cup.", weight: 7, category: "famous", expect: { won: false, teamScore: 0, oppScore: 1 } },
  { team: "BOS", opp: "MTL", season: "19761977", playoffGame: 4, label: "1977 Final sweep", story: "Montreal completes a four-game sweep of the Bruins in overtime.", weight: 5, category: "cult", expect: { won: false, ot: true } },
  { team: "BOS", opp: "MTL", season: "19771978", playoffGame: 6, label: "1978 Cup lost at the Garden", story: "Montreal wins the Cup on Boston Garden ice, again.", weight: 6, category: "famous", expect: { won: false } },
  { team: "BOS", opp: "EDM", season: "19891990", playoffGame: 1, label: "The triple-overtime opener", story: "Petr Klima ends the longest game in Final history at the time in the third overtime.", weight: 8, category: "famous", expect: { won: false, ot: true, otPeriods: 3, lastGoalBy: "Klima" } },
  { team: "BOS", opp: "EDM", season: "19891990", playoffGame: 5, label: "1990 Cup lost at home", story: "Edmonton wins the Cup at Boston Garden.", weight: 5, category: "cult", expect: { won: false } },
  { team: "BOS", opp: "VAN", season: "20102011", playoffGame: 3, label: "Eight after the Horton hit", story: "The game after Nathan Horton is knocked out, the Bruins win 8-1 and the series turns.", weight: 7, category: "famous", expect: { won: true, teamScore: 8, oppScore: 1 } },
  { team: "BOS", opp: "VAN", season: "20102011", playoffGame: 6, label: "Four goals in four minutes", story: "Boston scores four times in the first period to force Game 7.", weight: 7, category: "famous", expect: { won: true } },
  { team: "BOS", opp: "VAN", season: "20102011", playoffGame: 7, label: "2011: Cup in Vancouver", story: "Tim Thomas shuts out Vancouver in Game 7 and the Bruins win their first Cup in 39 years.", weight: 10, category: "mythic", expect: { won: true, teamScore: 4, oppScore: 0 } },
  { team: "BOS", opp: "VAN", season: "20102011", playoffGame: 2, label: "Burrows in 11 seconds", story: "Alex Burrows ends Game 2 eleven seconds into overtime.", weight: 5, category: "cult", expect: { won: false, ot: true, lastGoalBy: "Burrows" } },
  { team: "BOS", opp: "CHI", season: "20122013", playoffGame: 1, label: "Triple overtime in Chicago", story: "Boston loses the Final opener in the third overtime after leading by two in the third period.", weight: 7, category: "famous", expect: { won: false, ot: true, otPeriods: 3, ledBy: 2 } },
  { team: "BOS", opp: "CHI", season: "20122013", playoffGame: 2, label: "Paille in overtime", story: "Daniel Paille wins Game 2 in overtime to even the Final.", weight: 6, category: "cult", expect: { won: true, ot: true, lastGoalBy: "Paille" } },
  { team: "BOS", opp: "CHI", season: "20122013", playoffGame: 4, label: "6-5 in overtime", story: "Brent Seabrook ends a wild 6-5 game in overtime.", weight: 5, category: "cult", expect: { won: false, ot: true, teamScore: 5, oppScore: 6, lastGoalBy: "Seabrook" } },
  { team: "BOS", opp: "CHI", season: "20122013", playoffGame: 6, label: "17 seconds", story: "Leading 2-1 late in Game 6, Boston gives up two goals 17 seconds apart and Chicago wins the Cup at the Garden.", weight: 9, category: "mythic", expect: { won: false, teamScore: 2, oppScore: 3, ledBy: 1 } },
  { team: "BOS", opp: "STL", season: "20182019", playoffGame: 2, label: "Gunnarsson in overtime", story: "Carl Gunnarsson ends Game 2 in overtime to even the Final.", weight: 5, category: "cult", expect: { won: false, ot: true, lastGoalBy: "Gunnarsson" } },
  { team: "BOS", opp: "STL", season: "20182019", playoffGame: 5, label: "Chara's jaw, and the missed call", story: "Zdeno Chara plays with a broken jaw to a thunderous ovation, and St. Louis scores the winner moments after an uncalled trip on Noel Acciari.", weight: 7, category: "famous", expect: { won: false, teamScore: 1, oppScore: 2 }, sources: [ERA_2001] },
  { team: "BOS", opp: "STL", season: "20182019", playoffGame: 6, label: "Forcing Game 7", story: "Boston wins 5-1 in St. Louis to force a Game 7 at home.", weight: 6, category: "cult", expect: { won: true, teamScore: 5, oppScore: 1 } },
  { team: "BOS", opp: "STL", season: "20182019", playoffGame: 7, label: "2019: Game 7 at home", story: "St. Louis wins Game 7 at TD Garden. The Blues' first Cup.", weight: 10, category: "mythic", expect: { won: false, teamScore: 1, oppScore: 4 } },

  // ---- Playoff series classics ---------------------------------------------
  { team: "BOS", opp: "NYR", season: "19381939", playoffGame: 7, label: "Sudden Death Hill", story: "Mel Hill scores in the third overtime of Game 7, his third overtime winner of the series.", weight: 9, category: "famous", expect: { won: true, ot: true, otPeriods: 3, lastGoalBy: "Hill" } },
  { team: "BOS", opp: "MTL", season: "19701971", playoffGame: 2, label: "The 5-1 collapse", story: "Leading Montreal 5-1, the record-setting Bruins give up six straight goals and lose 7-5.", weight: 8, category: "famous", expect: { won: false, teamScore: 5, oppScore: 7, ledBy: 4 } },
  { team: "BOS", opp: "MTL", season: "19701971", playoffGame: 7, label: "Dryden's upset", story: "Rookie goalie Ken Dryden and Montreal eliminate the best team in hockey in Game 7 at Boston Garden.", weight: 9, category: "mythic", expect: { won: false } },
  { team: "BOS", opp: "MTL", season: "19781979", playoffGame: 6, label: "Forcing Game 7 in 1979", story: "Boston beats Montreal at the Garden to force Game 7.", weight: 5, category: "cult", expect: { won: true } },
  { team: "BOS", opp: "MTL", season: "19781979", playoffGame: 7, label: "Too many men", story: "Up 4-3 late, Boston is called for too many men. Guy Lafleur ties it on the power play and Yvon Lambert wins it in overtime.", weight: 10, category: "mythic", expect: { won: false, ot: true, teamScore: 4, oppScore: 5, ledBy: 1, lastGoalBy: "Lambert" } },
  { team: "BOS", opp: "MTL", season: "19871988", playoffGame: 5, label: "Finally, Montreal", story: "Boston beats Montreal in a playoff series for the first time since 1943.", weight: 9, category: "famous", expect: { won: true } },
  { team: "BOS", opp: "NJD", season: "19871988", playoffGame: 7, label: "To the 1988 Final", story: "Boston wins Game 7 against New Jersey to reach the Stanley Cup Final.", weight: 6, category: "cult", expect: { won: true } },
  { team: "BOS", opp: "PIT", season: "19901991", playoffGame: 6, label: "The 1991 conference final", story: "Up 2-0 in the series, Boston loses four straight to Pittsburgh.", weight: 5, category: "cult", expect: { won: false } },
  { team: "BOS", opp: "MTL", season: "20032004", playoffGame: 7, label: "The 2004 collapse", story: "Up three games to one, Boston loses Game 7 to Montreal at home.", weight: 8, category: "famous", expect: { won: false, teamScore: 0, oppScore: 2 } },
  { team: "BOS", opp: "MTL", season: "20072008", playoffGame: 7, label: "2008 Game 7 in Montreal", story: "The eighth-seeded Bruins push top-seeded Montreal to seven games before losing 5-0.", weight: 5, category: "cult", expect: { won: false, teamScore: 0, oppScore: 5 } },
  { team: "BOS", opp: "CAR", season: "20082009", playoffGame: 7, label: "Scott Walker in overtime", story: "Top-seeded Boston loses Game 7 to Carolina in overtime at home.", weight: 8, category: "famous", expect: { won: false, ot: true, lastGoalBy: "Walker" } },
  { team: "BOS", opp: "PHI", season: "20092010", playoffGame: 4, label: "The collapse begins", story: "Up three games to none, Boston loses Game 4 to Philadelphia in overtime.", weight: 5, category: "cult", expect: { won: false, ot: true } },
  { team: "BOS", opp: "PHI", season: "20092010", playoffGame: 7, label: "Up 3-0, again", story: "Boston leads Game 7 3-0 after blowing a 3-0 series lead, and loses 4-3.", weight: 9, category: "mythic", expect: { won: false, teamScore: 3, oppScore: 4, ledBy: 3 } },
  { team: "BOS", opp: "MTL", season: "20102011", playoffGame: 5, label: "Horton in double overtime", story: "Nathan Horton wins Game 5 against Montreal in double overtime.", weight: 6, category: "cult", expect: { won: true, ot: true, otPeriods: 2, lastGoalBy: "Horton" } },
  { team: "BOS", opp: "MTL", season: "20102011", playoffGame: 7, label: "Horton ends it", story: "Nathan Horton scores in overtime of Game 7 and the 2011 run is alive.", weight: 9, category: "famous", expect: { won: true, ot: true, lastGoalBy: "Horton" } },
  { team: "BOS", opp: "PHI", season: "20102011", playoffGame: 4, label: "The revenge sweep", story: "A year after the collapse, Boston sweeps Philadelphia.", weight: 7, category: "famous", expect: { won: true } },
  { team: "BOS", opp: "TBL", season: "20102011", playoffGame: 7, label: "1-0 to the Final", story: "Nathan Horton scores the only goal of Game 7 and Boston reaches the Final.", weight: 9, category: "famous", expect: { won: true, teamScore: 1, oppScore: 0, lastGoalBy: "Horton" } },
  { team: "BOS", opp: "WSH", season: "20112012", playoffGame: 7, label: "Joel Ward in overtime", story: "The defending champions lose Game 7 to Washington in overtime.", weight: 7, category: "famous", expect: { won: false, ot: true, lastGoalBy: "Ward" } },
  { team: "BOS", opp: "TOR", season: "20122013", playoffGame: 7, label: "Down 4-1 in Game 7", story: "Down 4-1 in the third, Boston scores three late and Patrice Bergeron wins it in overtime.", weight: 10, category: "mythic", expect: { won: true, ot: true, teamScore: 5, oppScore: 4, trailedBy: 3, lastGoalBy: "Bergeron" } },
  { team: "BOS", opp: "PIT", season: "20122013", playoffGame: 4, label: "Sweeping Pittsburgh", story: "Adam McQuaid's goal completes a four-game sweep of the Penguins.", weight: 7, category: "famous", expect: { won: true, teamScore: 1, oppScore: 0 } },
  { team: "BOS", opp: "MTL", season: "20132014", playoffGame: 7, label: "Presidents' Trophy, out in round two", story: "The Presidents' Trophy Bruins lose Game 7 to Montreal at home.", weight: 7, category: "famous", expect: { won: false } },
  { team: "BOS", opp: "TOR", season: "20172018", playoffGame: 7, label: "Seven in Game 7", story: "Boston scores four in the third and beats Toronto 7-4.", weight: 8, category: "famous", expect: { won: true, teamScore: 7, oppScore: 4 } },
  { team: "BOS", opp: "TOR", season: "20182019", playoffGame: 7, label: "Toronto again", story: "Boston beats Toronto in Game 7 for the third time in seven years.", weight: 7, category: "famous", expect: { won: true, teamScore: 5, oppScore: 1 } },
  { team: "BOS", opp: "CAR", season: "20182019", playoffGame: 4, label: "Sweep to the 2019 Final", story: "Boston sweeps Carolina to reach the Stanley Cup Final.", weight: 6, category: "cult", expect: { won: true } },
  { team: "BOS", opp: "TBL", season: "20192020", playoffGame: 5, label: "Hedman in the bubble", story: "Victor Hedman ends Boston's season in double overtime in the Toronto bubble.", weight: 5, category: "cult", expect: { won: false, ot: true, otPeriods: 2, lastGoalBy: "Hedman" } },
  { team: "BOS", opp: "CAR", season: "20212022", playoffGame: 7, label: "Game 7 in Raleigh", story: "Boston loses Game 7 at Carolina, the end of the Cassidy era.", weight: 6, category: "cult", expect: { won: false } },
  { team: "BOS", opp: "FLA", season: "20222023", playoffGame: 7, label: "After 65 wins", story: "The record-setting 65-win Bruins lose Game 7 to Florida in overtime.", weight: 9, category: "mythic", expect: { won: false, ot: true } },
  { team: "BOS", opp: "TOR", season: "20232024", playoffGame: 7, label: "Pastrnak in overtime", story: "David Pastrnak wins Game 7 against Toronto in overtime.", weight: 9, category: "famous", expect: { won: true, ot: true, lastGoalBy: "Pastrnak" } },
  { team: "BOS", opp: "FLA", season: "20232024", playoffGame: 6, label: "Florida again", story: "Florida eliminates Boston for the second straight spring.", weight: 5, category: "cult", expect: { won: false } },

  // ---- Regular-season nights -------------------------------------------------
  { team: "BOS", opp: "MMR", season: "19241925", date: "1924-12-01", label: "The first Bruins game", story: "The Bruins play their first NHL game and beat the Montreal Maroons.", weight: 7, category: "famous", expect: { won: true } },
  { team: "BOS", opp: "NYR", season: "19791980", date: "1979-12-23", label: "Into the stands at MSG", story: "Bruins players climb into the Madison Square Garden stands after a fan grabs Stan Jonathan's stick.", weight: 6, category: "cult", expect: {} },
  { team: "BOS", opp: "VAN", season: "19992000", date: "2000-02-21", label: "The McSorley slash", story: "Marty McSorley's slash on Donald Brashear ends his NHL career.", weight: 5, category: "cult", expect: {} },
  { team: "BOS", opp: "PHI", season: "20092010", date: "2010-01-01", label: "Winter Classic at Fenway", story: "Marco Sturm wins the Winter Classic in overtime at Fenway Park.", weight: 8, category: "famous", expect: { won: true, ot: true, lastGoalBy: "Sturm" } },
  { team: "BOS", opp: "DAL", season: "20102011", date: "2011-02-03", label: "Three fights in four seconds", story: "Three fights break out in the opening seconds against Dallas.", weight: 5, category: "cult", expect: { won: true } },
  { team: "BOS", opp: "MTL", season: "20102011", date: "2011-02-09", label: "The 8-6 brawl", story: "Boston beats Montreal 8-6 in a night that includes a goalie fight.", weight: 7, category: "famous", expect: { won: true, teamScore: 8, oppScore: 6 } },
  { team: "BOS", opp: "MTL", season: "20102011", date: "2011-03-08", label: "The Pacioretty hit", story: "Zdeno Chara's hit on Max Pacioretty at the Bell Centre.", weight: 5, category: "cult", expect: { won: false } },
  { team: "BOS", opp: "BUF", season: "20122013", date: "2013-04-17", label: "Boston Strong", story: "The first game in Boston after the Marathon bombing, opened by a Garden-wide anthem.", weight: 8, category: "famous", expect: { won: false, shootout: true } },
  { team: "BOS", opp: "CHI", season: "20182019", date: "2019-01-01", label: "Winter Classic at Notre Dame", story: "Boston beats Chicago at Notre Dame Stadium.", weight: 5, category: "cult", expect: { won: true } },
  { team: "BOS", opp: "PIT", season: "20222023", date: "2023-01-02", label: "Fenway, again", story: "Jake DeBrusk scores twice as Boston wins the Winter Classic at Fenway.", weight: 6, category: "cult", expect: { won: true, teamScore: 2, oppScore: 1, lastGoalBy: "DeBrusk" } },
  { team: "BOS", opp: "NYR", season: "20252026", date: "2026-01-10", label: "Pastrnak's six assists", story: "David Pastrnak sets up six goals in a 10-2 rout of the Rangers.", weight: 5, category: "cult", expect: { won: true, teamScore: 10, oppScore: 2 } },
  { team: "BOS", opp: "NYR", season: "20262027", date: "2026-09-29", label: "Opening night shutout", story: "Jeremy Swayman blanks the Rangers on opening night.", weight: 4, category: "cult", expect: { won: true, teamScore: 3, oppScore: 0 } },

  // ---- Web research (2026-10-01): significant for reasons the box score can't show ----
  // Official Bruins centennial lists by era, plus others where noted. Scores
  // are left to the data when sources disagree (e.g. Neely's 50th: 4-3 vs 6-3).
  { team: "BOS", opp: "MTL", season: "19281929", date: "1928-11-20", label: "Opening the Boston Garden", story: "The first game at the Boston Garden, a 1-0 loss to Montreal.", weight: 6, category: "cult", expect: { won: false }, sources: [ERA_1924] },
  { team: "BOS", opp: "TOR", season: "19331934", date: "1933-12-12", label: "The Ace Bailey game", story: "Eddie Shore's hit leaves Toronto's Ace Bailey with a fractured skull; the benefit game for him became the first All-Star Game.", weight: 6, category: "famous", featurable: false, expect: {}, sources: [BRUINS_TOP10, "https://en.wikipedia.org/wiki/Ace_Bailey"] },
  { team: "BOS", opp: "MTL", season: "19411942", date: "1942-02-10", label: "The Kraut Line goes to war", story: "Schmidt, Dumart and Bauer play their last game before joining the RCAF, and both teams carry them off the ice.", weight: 9, category: "mythic", expect: { won: true, teamScore: 8, oppScore: 1 }, sources: [BRUINS_TOP10, ERA_1924] },
  { team: "BOS", opp: "MTL", season: "19441945", date: "1945-03-18", label: "Richard's 50 in 50", story: "Maurice Richard scores his 50th goal in the season's 50th game, at Boston Garden.", weight: 6, category: "league", expect: { won: false, scoredBy: ["Richard"] }, sources: ["https://en.wikipedia.org/wiki/50_goals_in_50_games"] },
  { team: "BOS", opp: "MTL", season: "19571958", date: "1958-01-18", label: "Willie O'Ree's debut", story: "Willie O'Ree becomes the first Black player in NHL history, for Boston in Montreal.", weight: 9, category: "mythic", expect: { won: true }, sources: [BRUINS_TOP10, ERA_1924] },
  { team: "BOS", opp: "DET", season: "19661967", date: "1966-10-19", label: "Bobby Orr's debut", story: "An 18-year-old Bobby Orr plays his first NHL game.", weight: 8, category: "famous", expect: { won: true, teamScore: 6, oppScore: 2 }, sources: [ERA_1960] },
  { team: "BOS", opp: "CHI", season: "19661967", date: "1966-12-02", label: "Bucyk passes Schmidt", story: "Johnny Bucyk scores twice to become the Bruins' all-time leading goal scorer.", weight: 4, category: "cult", expect: { teamScore: 4, oppScore: 4, scoredBy: ["Bucyk"] }, sources: [ERA_1960] },
  { team: "BOS", opp: "PIT", season: "19681969", date: "1969-03-02", label: "Esposito's 100th point", story: "Phil Esposito becomes the first player in NHL history to reach 100 points in a season.", weight: 6, category: "famous", expect: { won: true, scoredBy: ["Esposito"] }, sources: [ERA_1960] },
  { team: "BOS", opp: "LAK", season: "19701971", date: "1971-03-11", label: "Esposito reaches 60", story: "Phil Esposito reaches 60 goals in the record-setting 1970-71 season.", weight: 5, category: "cult", expect: { won: true, scoredBy: ["Esposito"] }, sources: [REG_SEASON] },
  { team: "BOS", opp: "NYR", season: "19731974", date: "1973-11-15", label: "Orr's seven points", story: "Bobby Orr scores three goals and four assists in a 10-2 rout of the Rangers.", weight: 5, category: "cult", expect: { won: true, teamScore: 10, oppScore: 2, scoredBy: ["Orr"] }, sources: [ERA_1960] },
  { team: "BOS", opp: "NYR", season: "19741975", date: "1974-12-19", label: "Five goals in 2:55", story: "Boston scores five goals in under three minutes on the way to an 11-3 win.", weight: 4, category: "cult", expect: { won: true, teamScore: 11, oppScore: 3 }, sources: [ERA_1960] },
  { team: "BOS", opp: "TOR", season: "19751976", date: "1976-02-07", label: "Sittler's ten points", story: "Toronto's Darryl Sittler scores six goals and ten points against Boston, a record that still stands.", weight: 6, category: "famous", expect: { won: false, scoredBy: ["Sittler"] }, sources: ["https://en.wikipedia.org/wiki/Darryl_Sittler"] },
  { team: "BOS", opp: "TOR", season: "19771978", date: "1978-04-08", label: "Eleven 20-goal scorers", story: "The Lunch Pail A.C. sets an NHL record with eleven 20-goal scorers.", weight: 4, category: "cult", expect: { won: true }, sources: [ERA_1977] },
  { team: "BOS", opp: "WIN", season: "19791980", date: "1979-10-11", label: "Ray Bourque's debut", story: "Ray Bourque scores in his first NHL game.", weight: 7, category: "famous", expect: { won: true, teamScore: 4, oppScore: 0, scoredBy: ["Bourque"] }, sources: [ERA_1977] },
  { team: "BOS", opp: "MNS", season: "19801981", date: "1981-02-26", label: "406 penalty minutes", story: "Boston and Minnesota combine for a then-record 406 penalty minutes.", weight: 5, category: "cult", expect: { won: true }, sources: [ERA_1977] },
  { team: "BOS", opp: "BUF", season: "19821983", playoffGame: 7, label: "Brad Park in overtime", story: "Brad Park wins Game 7 against Buffalo in overtime; Rick Middleton sets a playoff-series points record.", weight: 7, category: "famous", expect: { won: true, ot: true, lastGoalBy: "Park" }, sources: [ERA_1977] },
  { team: "BOS", opp: "PHI", season: "19831984", date: "1983-10-20", label: "Overtime returns", story: "The first regular-season overtime game in the NHL in 40 years ends in a tie.", weight: 3, category: "cult", expect: { teamScore: 3, oppScore: 3 }, sources: [ERA_1977] },
  { team: "BOS", opp: "*", season: "19871988", date: "1987-12-03", label: "Bourque's 77", story: "On the night Phil Esposito's No. 7 is retired, Ray Bourque reveals his new No. 77.", weight: 7, category: "famous", expect: {}, sources: [BRUINS_TOP10, ERA_1986] },
  { team: "BOS", opp: "CHI", season: "19881989", date: "1988-10-16", label: "Neely's seven points", story: "Cam Neely ties the club record with three goals and four assists.", weight: 4, category: "cult", expect: { won: true, teamScore: 10, oppScore: 3, scoredBy: ["Neely"] }, sources: [ERA_1986] },
  { team: "BOS", opp: "MTL", season: "19891990", date: "1990-04-27", label: "Wesley's late winner", story: "Glen Wesley scores with 1:13 left against Montreal.", weight: 4, category: "cult", expect: { won: true }, sources: [ERA_1986] },
  { team: "BOS", opp: "PIT", season: "19901991", playoffGame: 3, label: "Ulf Samuelsson on Neely", story: "Ulf Samuelsson's knee-on-knee hit on Cam Neely, the start of the injuries that shortened his career.", weight: 5, category: "cult", featurable: false, expect: {}, sources: ["https://en.wikipedia.org/wiki/Cam_Neely"] },
  { team: "BOS", opp: "HFD", season: "19921993", date: "1993-03-22", label: "Juneau's rookie record", story: "Joe Juneau sets the NHL record for points by a rookie left winger.", weight: 3, category: "cult", expect: { won: true }, sources: [ERA_1986] },
  { team: "BOS", opp: "WSH", season: "19931994", date: "1994-03-07", label: "Neely's 50 in 44", story: "Cam Neely scores his 50th goal in his 44th game, on one good knee.", weight: 8, category: "famous", expect: { won: true, scoredBy: ["Neely"] }, sources: [BRUINS_TOP10, ERA_1986, REG_SEASON] },
  { team: "BOS", opp: "NYI", season: "19951996", date: "1995-10-07", label: "Opening the FleetCenter", story: "The first game at the new FleetCenter ends in a 4-4 tie.", weight: 5, category: "cult", expect: { teamScore: 4, oppScore: 4 }, sources: [ERA_1986] },
  { team: "BOS", opp: "TBL", season: "19961997", date: "1997-02-01", label: "Bourque passes Bucyk", story: "Ray Bourque becomes the Bruins' all-time points leader.", weight: 5, category: "cult", expect: { won: true }, sources: [ERA_1986] },
  { team: "BOS", opp: "CAR", season: "19981999", date: "1999-04-30", label: "Anson Carter in double overtime", story: "Anson Carter wins a playoff game against Carolina in double overtime.", weight: 4, category: "cult", expect: { won: true, ot: true, otPeriods: 2, lastGoalBy: "Carter" }, sources: [ERA_1986] },
  { team: "BOS", opp: "PHI", season: "20072008", date: "2007-10-27", label: "Bergeron's concussion", story: "Patrice Bergeron is hit from behind into the boards and misses the rest of the season.", weight: 4, category: "cult", featurable: false, expect: {}, sources: ["https://en.wikipedia.org/wiki/Patrice_Bergeron"] },
  { team: "BOS", opp: "MTL", season: "20072008", playoffGame: 6, label: "This building is vibrating", story: "Marco Sturm's winner forces Game 7 against top-seeded Montreal; the rebuild has arrived.", weight: 6, category: "cult", expect: { won: true }, sources: [ERA_2001] },
  { team: "BOS", opp: "PIT", season: "20092010", date: "2010-03-07", label: "Cooke on Savard", story: "Matt Cooke's blindside hit on Marc Savard, who would play only a few more games.", weight: 4, category: "cult", featurable: false, expect: {}, sources: ["https://en.wikipedia.org/wiki/Marc_Savard"] },
  { team: "BOS", opp: "TBL", season: "20102011", playoffGame: 5, label: "Thomas's stick save", story: "Tim Thomas's diving stick save in Game 5 of the conference final.", weight: 5, category: "cult", expect: { won: true }, sources: [ERA_2001] },
  { team: "BOS", opp: "PIT", season: "20122013", date: "2013-06-05", label: "Campbell's block", story: "Gregory Campbell finishes a penalty kill on a broken leg; Boston wins in double overtime.", weight: 7, category: "famous", expect: { won: true, ot: true, otPeriods: 2 }, sources: [ERA_2001] },
  { team: "BOS", opp: "TBL", season: "20222023", date: "2022-11-21", label: "Bergeron's 1,000th point", story: "Patrice Bergeron reaches 1,000 career points.", weight: 5, category: "cult", expect: {}, sources: [ERA_2001] },
  { team: "BOS", opp: "VAN", season: "20222023", date: "2023-02-25", label: "Ullmark scores", story: "Linus Ullmark becomes the first Bruins goalie to score a goal.", weight: 6, category: "cult", expect: { won: true, scoredBy: ["Ullmark"] }, sources: [ERA_2001] },
  { team: "BOS", opp: "PHI", season: "20222023", date: "2023-04-09", label: "The 63rd win", story: "Boston breaks the NHL record for wins in a season.", weight: 7, category: "famous", expect: { won: true, teamScore: 5, oppScore: 3, scoredBy: ["Pastrnak"] }, sources: [REG_SEASON, ERA_2001] },

  // ---- League-wide moments (web research) ----
  { team: "TOR", opp: "DET", season: "19631964", playoffGame: 6, label: "Baun on a broken leg", story: "Bobby Baun scores in overtime of the Final on a broken leg.", weight: 6, category: "league", expect: { won: true, ot: true, lastGoalBy: "Baun" }, sources: ["https://en.wikipedia.org/wiki/Bobby_Baun"] },
  { team: "NYI", opp: "QUE", season: "19801981", date: "1981-01-24", label: "Bossy's 50 in 50", story: "Mike Bossy scores his 50th goal in the season's 50th game.", weight: 6, category: "league", expect: { won: true, scoredBy: ["Bossy"] }, sources: ["https://en.wikipedia.org/wiki/50_goals_in_50_games"] },
  { team: "EDM", opp: "PHI", season: "19811982", date: "1981-12-30", label: "Gretzky's 50 in 39", story: "Wayne Gretzky scores five goals to reach 50 in 39 games.", weight: 7, category: "league", expect: { won: true, scoredBy: ["Gretzky"] }, sources: ["https://en.wikipedia.org/wiki/50_goals_in_50_games"] },
  { team: "MTL", opp: "QUE", season: "19831984", playoffGame: 6, label: "The Good Friday Massacre", story: "Bench-clearing brawls between Montreal and Quebec in the series-clinching game.", weight: 6, category: "league", expect: { won: true }, sources: ["https://en.wikipedia.org/wiki/Good_Friday_Massacre_(ice_hockey)"] },
  { team: "PIT", opp: "NJD", season: "19881989", date: "1988-12-31", label: "Five goals, five ways", story: "Mario Lemieux scores at even strength, on the power play, shorthanded, on a penalty shot and into an empty net.", weight: 7, category: "league", expect: { won: true, scoredBy: ["Lemieux"] }, sources: ["https://en.wikipedia.org/wiki/Mario_Lemieux"] },
  { team: "LAK", opp: "EDM", season: "19891990", date: "1989-10-15", label: "Gretzky passes Howe", story: "Wayne Gretzky becomes the NHL's all-time points leader, in Edmonton.", weight: 7, category: "league", expect: { won: true, ot: true }, sources: ["https://en.wikipedia.org/wiki/Wayne_Gretzky"] },
  { team: "PIT", opp: "PHI", season: "19921993", date: "1993-03-02", label: "Lemieux returns from cancer", story: "Mario Lemieux plays the day of his final radiation treatment, and Philadelphia's crowd gives him an ovation.", weight: 6, category: "league", expect: {}, sources: ["https://en.wikipedia.org/wiki/Mario_Lemieux"] },
  { team: "LAK", opp: "VAN", season: "19931994", date: "1994-03-23", label: "Gretzky's 802nd", story: "Wayne Gretzky passes Gordie Howe for the most goals in NHL history.", weight: 7, category: "league", expect: { scoredBy: ["Gretzky"] }, sources: ["https://en.wikipedia.org/wiki/Wayne_Gretzky"] },
  { team: "NYR", opp: "PIT", season: "19981999", date: "1999-04-18", label: "Gretzky's last game", story: "Wayne Gretzky plays his final NHL game at Madison Square Garden.", weight: 6, category: "league", expect: { won: false, ot: true }, sources: ["https://en.wikipedia.org/wiki/Wayne_Gretzky"] },
  { team: "WSH", opp: "NYI", season: "20242025", date: "2025-04-06", label: "Ovechkin's 895th", story: "Alex Ovechkin passes Gretzky for the most goals in NHL history.", weight: 7, category: "league", expect: { scoredBy: ["Ovechkin"] }, sources: ["https://en.wikipedia.org/wiki/Alexander_Ovechkin"] },

  // ---- League-wide classics (for when the closest twin isn't a Bruins game) ----
  { team: "DET", opp: "NYR", season: "19491950", playoffGame: 7, label: "Babando in double overtime", story: "Pete Babando wins the Cup for Detroit in the second overtime of Game 7.", weight: 7, category: "league", expect: { won: true, ot: true, otPeriods: 2, lastGoalBy: "Babando" } },
  { team: "TOR", opp: "MTL", season: "19501951", playoffGame: 5, label: "Barilko's Cup winner", story: "Bill Barilko wins the Cup in overtime. He would disappear that summer.", weight: 7, category: "league", expect: { won: true, ot: true, lastGoalBy: "Barilko" } },
  { team: "DET", opp: "MTL", season: "19531954", playoffGame: 7, label: "Leswick's Game 7 winner", story: "Tony Leswick wins Game 7 of the Final in overtime.", weight: 6, category: "league", expect: { won: true, ot: true, lastGoalBy: "Leswick" } },
  { team: "NYI", opp: "PHI", season: "19791980", playoffGame: 6, label: "Nystrom's Cup winner", story: "Bob Nystrom wins the Islanders' first Cup in overtime.", weight: 7, category: "league", expect: { won: true, ot: true, lastGoalBy: "Nystrom" } },
  { team: "LAK", opp: "EDM", season: "19811982", playoffGame: 3, label: "Miracle on Manchester", story: "Los Angeles comes back from 5-0 down to beat Gretzky's Oilers in overtime.", weight: 8, category: "league", expect: { won: true, ot: true, trailedBy: 5 } },
  { team: "NYI", opp: "WSH", season: "19861987", playoffGame: 7, label: "The Easter Epic", story: "Pat LaFontaine ends Game 7 in the fourth overtime.", weight: 8, category: "league", expect: { won: true, ot: true, otPeriods: 4, lastGoalBy: "LaFontaine" } },
  { team: "LAK", opp: "TOR", season: "19921993", playoffGame: 7, label: "Gretzky's hat trick in Toronto", story: "Wayne Gretzky scores three in Game 7 to send the Kings to the Final.", weight: 7, category: "league", expect: { won: true } },
  { team: "NYR", opp: "NJD", season: "19931994", playoffGame: 7, label: "Matteau, Matteau", story: "Stephane Matteau wins Game 7 in double overtime.", weight: 7, category: "league", expect: { won: true, ot: true, otPeriods: 2, lastGoalBy: "Matteau" } },
  { team: "NYR", opp: "VAN", season: "19931994", playoffGame: 7, label: "54 years", story: "The Rangers win Game 7 for their first Cup since 1940.", weight: 7, category: "league", expect: { won: true, teamScore: 3, oppScore: 2 } },
  { team: "DAL", opp: "BUF", season: "19981999", playoffGame: 6, label: "No goal", story: "Brett Hull's triple-overtime winner, with his skate in the crease.", weight: 7, category: "league", expect: { won: true, ot: true, otPeriods: 3, lastGoalBy: "Hull" } },
  { team: "PHI", opp: "PIT", season: "19992000", playoffGame: 4, label: "Five overtimes", story: "Keith Primeau ends the longest modern NHL game in the fifth overtime.", weight: 6, category: "league", expect: { won: true, ot: true, otPeriods: 5, lastGoalBy: "Primeau" } },
  { team: "COL", opp: "NJD", season: "20002001", playoffGame: 7, label: "Bourque's Cup", story: "Ray Bourque finally lifts the Cup, in his 22nd season, after leaving Boston.", weight: 8, category: "league", expect: { won: true } },
  { team: "PIT", opp: "DET", season: "20082009", playoffGame: 7, label: "Game 7 in Detroit", story: "Pittsburgh wins Game 7 of the Final on the road.", weight: 6, category: "league", expect: { won: true, teamScore: 2, oppScore: 1 } },
  { team: "CHI", opp: "PHI", season: "20092010", playoffGame: 6, label: "Kane's overtime winner", story: "Patrick Kane ends a 49-year drought in overtime.", weight: 6, category: "league", expect: { won: true, ot: true, lastGoalBy: "Kane" } },
  { team: "LAK", opp: "SJS", season: "20132014", playoffGame: 7, label: "Kings from 0-3", story: "Los Angeles completes a comeback from 3-0 down in the series.", weight: 6, category: "league", expect: { won: true } },
  { team: "WSH", opp: "VGK", season: "20172018", playoffGame: 5, label: "Ovechkin's Cup", story: "Washington wins its first Stanley Cup.", weight: 6, category: "league", expect: { won: true } },
];
