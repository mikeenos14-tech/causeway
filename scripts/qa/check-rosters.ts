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

const missingOn = async (t: string) => {
  const d = await nhl(`https://api-web.nhle.com/v1/roster/${t}/current`);
  const names = [...d.forwards, ...d.defensemen, ...d.goalies].map((p: { firstName: { default: string }; lastName: { default: string } }) => `${p.firstName.default} ${p.lastName.default}`);
  const html = decode(await fetch(`${BASE}/teams/${t}/roster`).then((r) => r.text()));
  return { names, absent: names.filter((n) => !html.includes(`>${n}<`)) };
};

(async () => {
  let checked = 0;
  const first = new Map<string, string[]>();
  for (const t of TEAMS) {
    const { names, absent } = await missingOn(t);
    checked += names.length;
    if (absent.length) first.set(t, absent);
    console.log(`${t}: ${names.length} rostered, ${absent.length} missing${absent.length ? ` (${absent.join(", ")})` : ""}`);
    await new Promise((r) => setTimeout(r, 400));
  }
  // A roster move in the minutes before this check isn't on the page yet:
  // rosters sync every 30 minutes and the page caches for 5 (found
  // 2026-10-07). The workflow syncs right before this; wait out the page
  // cache and look again. Only players still missing count.
  let missing = 0;
  if (first.size) {
    console.log(`\nRechecking ${first.size} team(s) in 5.5 minutes, after the page cache refreshes...`);
    await new Promise((r) => setTimeout(r, 330_000));
    for (const t of first.keys()) {
      const { absent } = await missingOn(t);
      missing += absent.length;
      console.log(`${t} recheck: ${absent.length ? `still missing ${absent.join(", ")}` : "all listed now"}`);
    }
  }
  console.log(`\n${checked} rostered players checked, ${missing} missing from their team's Roster page.`);
  process.exit(missing ? 1 : 0);
})();
