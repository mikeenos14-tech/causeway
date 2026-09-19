// One-off audit: re-check every already-stored highlight against the
// (newly broadened) unauthorized-player validator, to find violations that
// predate the fix rather than assume only the two already-found cases exist.
import { Client } from "pg";

const TEAM_WORDS: Record<string, string[]> = {
  ANA: ["anaheim", "ducks"], ARI: ["arizona", "coyotes"], ATL: ["atlanta", "thrashers"],
  BOS: ["boston", "bruins"], BUF: ["buffalo", "sabres"], CAR: ["carolina", "hurricanes"],
  CBJ: ["columbus", "blue", "jackets"], CGY: ["calgary", "flames"], CHI: ["chicago", "blackhawks"],
  COL: ["colorado", "avalanche"], DAL: ["dallas", "stars"], DET: ["detroit", "red", "wings"],
  EDM: ["edmonton", "oilers"], FLA: ["florida", "panthers"], LAK: ["los", "angeles", "kings"],
  MIN: ["minnesota", "wild"], MTL: ["montreal", "montréal", "canadiens", "habs"],
  NJD: ["new", "jersey", "devils"], NSH: ["nashville", "predators"], NYI: ["new", "york", "islanders"],
  NYR: ["new", "york", "rangers"], OTT: ["ottawa", "senators"], PHI: ["philadelphia", "flyers"],
  PHX: ["phoenix", "coyotes"], PIT: ["pittsburgh", "penguins"], SEA: ["seattle", "kraken"],
  SJS: ["san", "jose", "sharks"], STL: ["st", "louis", "blues"], TBL: ["tampa", "bay", "lightning"],
  TOR: ["toronto", "maple", "leafs"], UTA: ["utah", "mammoth"], VAN: ["vancouver", "canucks"],
  VGK: ["vegas", "golden", "knights"], WPG: ["winnipeg", "jets"], WSH: ["washington", "capitals", "caps"],
};
const GENERIC_ALLOWED_WORDS = [
  "tonight", "today", "that", "this", "these", "those", "it", "he", "she", "they", "both", "there",
];
const ACTION_VERBS =
  "shut|scored?|recorded?|extended?|hits?|notched?|lit|went|had|posted?|snapped|couldn.t|picked|reached|earned|tied|broke|delivered|chipped|stayed|kept|joined|goes|keeps|didn.t|wasn.t|isn.t";
const namePattern = new RegExp(`\\b([A-Z][a-zA-Z]+)(?:'s\\b|\\s+(?:${ACTION_VERBS})\\b)`, "g");

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const { rows } = await client.query(`
    select n.game_id, n.headline, n.body, n.facts_json, ht.abbrev as home, at.abbrev as away
    from narratives n
    join games g on g.id = n.game_id
    join teams ht on ht.id = g.home_team_id
    join teams at on at.id = g.away_team_id
    where n.kind = 'highlights'
  `);

  const flagged: { game_id: number; headline: string; name: string }[] = [];

  for (const row of rows) {
    const factsTextLower = row.facts_json.map((f: { fact: string }) => f.fact).join(" ").toLowerCase();
    const allowedTeamWords = [
      ...(TEAM_WORDS[row.home] ?? []),
      ...(TEAM_WORDS[row.away] ?? []),
      row.home.toLowerCase(),
      row.away.toLowerCase(),
    ];
    const combinedText = `${row.headline} ${row.body}`;
    const candidateNames = new Set([...combinedText.matchAll(namePattern)].map((m) => m[1]));
    for (const name of candidateNames) {
      const lower = name.toLowerCase();
      if (factsTextLower.includes(lower)) continue;
      if (allowedTeamWords.includes(lower)) continue;
      if (GENERIC_ALLOWED_WORDS.includes(lower)) continue;
      flagged.push({ game_id: row.game_id, headline: row.headline, name });
    }
  }

  console.log(`Checked ${rows.length} stored highlights. Flagged: ${flagged.length}`);
  for (const f of flagged) console.log(`  game ${f.game_id}: "${f.name}" not grounded — "${f.headline}"`);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
