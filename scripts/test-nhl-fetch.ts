// Tests lib/nhl-fetch.ts with a simulated NHL API: temporary failures are
// retried, a real 404 means "doesn't exist", and an outage that outlasts
// the retries throws instead of passing for "no data". Also checks that
// the game preview turns an outage into an error (a "try again" page), not
// a false "not found".
//
// Usage: npx tsx --env-file=.env.local scripts/test-nhl-fetch.ts

import { nhlJson, NhlUnavailableError } from "../lib/nhl-fetch";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
};

function fakeFetch(responses: (number | "network")[]) {
  let i = 0;
  const calls = { n: 0 };
  globalThis.fetch = (async () => {
    calls.n++;
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r === "network") throw new TypeError("fetch failed");
    return new Response(r === 200 ? JSON.stringify({ ok: true }) : "<html>error</html>", { status: r });
  }) as typeof fetch;
  return calls;
}

async function main() {
  const realFetch = globalThis.fetch;

  let calls = fakeFetch([429, 503, 200]);
  check("rate limit then server error then success: returns the data", JSON.stringify(await nhlJson("https://x/test", 60)) === '{"ok":true}');
  check("  ...after exactly 3 attempts", calls.n === 3, String(calls.n));

  calls = fakeFetch(["network", 200]);
  check("a network blip is retried", JSON.stringify(await nhlJson("https://x/test", 60)) === '{"ok":true}' && calls.n === 2);

  calls = fakeFetch([404]);
  check("a real 404 means the thing doesn't exist (null), no retries", (await nhlJson("https://x/test", 60)) === null && calls.n === 1);

  fakeFetch([500, 500, 500]);
  let threw = false;
  try {
    await nhlJson("https://x/test", 60);
  } catch (e) {
    threw = e instanceof NhlUnavailableError;
  }
  check("an outage that outlasts the retries throws, never returns 'no data'", threw);

  // The game preview: an outage must throw (-> "try again" page), not
  // return null (-> 404).
  const { getPreview } = await import("../lib/preview-data");
  fakeFetch([429, 429, 429]);
  let previewThrew = false;
  try {
    await getPreview(2026020019);
  } catch {
    previewThrew = true;
  }
  check("game preview during an outage shows 'try again', not 'not found'", previewThrew);
  fakeFetch([404]);
  check("game preview for a game the NHL doesn't have is a real 404", (await getPreview(2026099999)) === null);

  globalThis.fetch = realFetch;
  const real = await getPreview(2026020019);
  check("real feed: tomorrow's BOS @ WPG preview loads", real?.away.abbrev === "BOS" && real?.home.abbrev === "WPG", `${real?.away.abbrev} @ ${real?.home.abbrev}`);

  console.log(`\n${failed === 0 ? "All passed." : `${failed} failed.`}`);
  process.exit(failed ? 1 : 0);
}
main();
