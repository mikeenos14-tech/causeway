// Season pages live at a path ("/schedule/2010-11"), not a query string
// ("?season=20102011"): a query forces a fresh render on every visit,
// while a path can be cached like any other page. Old ?season= links
// redirect (next.config.ts).

// "20102011" -> "2010-11"; "19992000" -> "1999-00".
export const seasonPath = (seasonId: string) => `${seasonId.slice(0, 4)}-${seasonId.slice(6, 8)}`;

// "2010-11" -> "20102011"; anything malformed -> null.
export function seasonFromPath(path: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(path);
  if (!m) return null;
  const start = Number(m[1]);
  const end = start + 1;
  if (String(end).slice(2) !== m[2]) return null;
  return `${start}${end}`;
}

export const scheduleHref = (seasonId: string | null) => (seasonId ? `/schedule/${seasonPath(seasonId)}` : "/schedule");
