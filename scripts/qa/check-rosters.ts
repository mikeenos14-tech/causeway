// Every team's Roster page against the NHL's live current roster: every
// rostered player must appear, by name, on the page. Run after any change
// to the roster page or its data. One team at a time (NHL rate limits).
//
// Usage: npx tsx scripts/qa/check-rosters.ts [base-url]   (default http://localhost:3978)

const BASE = process.argv[2] ?? "http://localhost:3978";
const TEAMS = "ANA BOS BUF CAR CBJ CGY CHI COL DAL DET EDM FLA LAK MIN MTL NJD NSH NYI NYR OTT PHI PIT SEA SJS STL TBL TOR UTA VAN VGK WPG WSH".split(" ");
async function nhl(url: string) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(url, { headers: { "User-Agent": "causeway-qa/1.0" } });
    if (r.ok && (r.headers.get("content-type") ?? "").includes("json")) return r.json();
    await new Promise((res) => setTimeout(res, 3000 * (i + 1)));
  }
  throw new Error(`NHL unavailable: ${url}`);
}
const decode = (s: string) => s.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/<!-- -->/g, "");

(async () => {
  let checked = 0, missing = 0;
  for (const t of TEAMS) {
    const d = await nhl(`https://api-web.nhle.com/v1/roster/${t}/current`);
    const names = [...d.forwards, ...d.defensemen, ...d.goalies].map((p: { firstName: { default: string }; lastName: { default: string } }) => `${p.firstName.default} ${p.lastName.default}`);
    const html = decode(await fetch(`${BASE}/teams/${t}/roster`).then((r) => r.text()));
    const absent = names.filter((n) => !html.includes(`>${n}<`));
    checked += names.length;
    missing += absent.length;
    console.log(`${t}: ${names.length} rostered, ${absent.length} missing${absent.length ? ` (${absent.join(", ")})` : ""}`);
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log(`\n${checked} rostered players checked, ${missing} missing from their team's Roster page.`);
  process.exit(missing ? 1 : 0);
})();
