// Every call to the NHL's public API goes through here, so a temporary
// failure (rate limit, 5xx, network) is never mistaken for an answer.
// Found by a site crawl (2026-10-01): treating any failed request as "no
// data" turned real game pages into "not found" under load, and could have
// told fans a departed player was "not on an NHL roster" when the lookup
// had merely failed.
//
//   returns the parsed JSON     the NHL answered
//   returns null                the NHL says it doesn't exist (404)
//   throws NhlUnavailableError  still failing after retries
// Callers decide what an outage means for their page; they never get to
// treat it as an answer by accident.

export class NhlUnavailableError extends Error {}

const WAITS_MS = [0, 400, 1200];

export async function nhlJson<T = unknown>(url: string, revalidateSeconds: number): Promise<T | null> {
  let last = "";
  for (const wait of WAITS_MS) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      const res = await fetch(url, { next: { revalidate: revalidateSeconds } });
      if (res.status === 404) return null;
      if (res.ok) return (await res.json()) as T;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
  }
  throw new NhlUnavailableError(`NHL API unavailable: ${url} (${last})`);
}
