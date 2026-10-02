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

// Clubs no longer in the league (history pages): the nickname is the last
// word, except these two-word ones.
const TWO_WORD = ["Red Wings", "Maple Leafs", "Blue Jackets", "Golden Knights", "Golden Seals", "North Stars", "St. Patricks", "Blue Shirts"];

export const teamNickname = (abbrev: string, fullName: string) => {
  if (TEAM_NICKNAMES[abbrev]) return TEAM_NICKNAMES[abbrev];
  // "Ottawa Senators (1917)": the year tells clubs apart in full names only.
  const name = fullName.replace(/\s*\(\d{4}\)$/, "");
  const two = TWO_WORD.find((n) => name.endsWith(` ${n}`));
  return two ?? name.split(" ").at(-1) ?? name;
};
