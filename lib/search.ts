// Header search ranking (components/SiteSearch.tsx), kept pure so it's
// unit-tested (scripts/test-search.ts). Runs in the browser over the whole
// index on every keystroke, so it stays simple and fast.

import type { SearchIndex } from "@/app/api/search-index/route";

export type SearchHit =
  | { kind: "team"; href: string; title: string; detail: string }
  | { kind: "player"; href: string; title: string; detail: string };

// Lowercase, accents stripped: "Lafrenière" matches "lafreniere".
export function normalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

const POS: Record<string, string> = { C: "C", L: "LW", R: "RW", D: "D", G: "G" };
// The player's most recent season, "2022-23". Not a career span: our data
// starts in 2007-08, so "2007–23" for Bergeron would read as his debut.
const seasonLabel = (season: string) => `${season.slice(0, 4)}-${season.slice(6)}`;

/**
 * Best matches for a query: teams first when they match, then players.
 * A player ranks by how the query matches (whole name or last name from
 * the start beats a match in the middle); ties go to players who've played
 * for the Bruins, then bigger careers, then recency. Found in testing:
 * ranking ties by recency put Jonatan Berggren above Patrice Bergeron for
 * "berg", which no Bruins fan means.
 */
export function search(index: SearchIndex, query: string, limit = 8): SearchHit[] {
  const q = normalize(query);
  if (q.length < 2) return [];

  const teams: SearchHit[] = index.teams
    .filter((t) => normalize(t.name).includes(q) || normalize(t.abbrev) === q)
    .slice(0, 3)
    .map((t) => ({ kind: "team", href: `/teams/${t.abbrev}`, title: t.name, detail: t.abbrev }));

  const scored: { p: SearchIndex["players"][number]; score: number }[] = [];
  for (const p of index.players) {
    const name = normalize(p.name);
    const words = name.split(/\s+/);
    let score = 0;
    if (name.startsWith(q)) score = 3;
    else if (words.some((w) => w.startsWith(q)) || words.slice(1).join(" ").startsWith(q)) score = 2;
    else if (name.includes(q)) score = 1;
    if (score) scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score || Number(b.p.bos) - Number(a.p.bos) || b.p.gp - a.p.gp || b.p.to.localeCompare(a.p.to));

  const players: SearchHit[] = scored.slice(0, limit - teams.length).map(({ p }) => ({
    kind: "player",
    href: `/players/${p.id}`,
    title: p.name,
    detail: `${POS[p.pos] ?? p.pos} · ${p.team} · ${seasonLabel(p.to)}`,
  }));
  return [...teams, ...players];
}
