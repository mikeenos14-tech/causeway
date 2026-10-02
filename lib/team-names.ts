// Team nicknames for tight mobile rows ("Blue Jackets", not "Columbus Blue
// Ja…"). Written out rather than derived by dropping the city, which would
// mangle "Red Wings", "Maple Leafs" and "Golden Knights".
export const TEAM_NICKNAMES: Record<string, string> = {
  ANA: "Ducks", BOS: "Bruins", BUF: "Sabres", CAR: "Hurricanes", CBJ: "Blue Jackets", CGY: "Flames",
  CHI: "Blackhawks", COL: "Avalanche", DAL: "Stars", DET: "Red Wings", EDM: "Oilers", FLA: "Panthers",
  LAK: "Kings", MIN: "Wild", MTL: "Canadiens", NJD: "Devils", NSH: "Predators", NYI: "Islanders",
  NYR: "Rangers", OTT: "Senators", PHI: "Flyers", PIT: "Penguins", SEA: "Kraken", SJS: "Sharks",
  STL: "Blues", TBL: "Lightning", TOR: "Maple Leafs", UTA: "Mammoth", VAN: "Canucks", VGK: "Golden Knights",
  WPG: "Jets", WSH: "Capitals",
};

export const teamNickname = (abbrev: string, fullName: string) => TEAM_NICKNAMES[abbrev] ?? fullName;
