const MONTH_ABBREV = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Reads the calendar date without ever going through a local-timezone
// conversion — `new Date(x).toLocaleDateString()` can roll a date back a
// day in a behind-UTC timezone (found live: a real Sept 20 game displayed
// as "Sep 19"). Same "copy the digits, never do timezone arithmetic" rule
// established for the Q&A engine. Two real input shapes reach this: a
// `Date` object from Postgres (date/timestamp columns come back as Date
// instances, always UTC-midnight-for-that-day — read with UTC getters,
// not local ones) and a bare "YYYY-MM-DD" string from the live NHL
// schedule API (no time component at all — parse its digits directly,
// since `new Date("YYYY-MM-DD")` parses that as literal UTC midnight, a
// different and more naive value than what's stored in our own DB).
export function formatGameDate(date: string | Date, includeYear = false) {
  let month: number, day: number, year: number;
  if (date instanceof Date) {
    month = date.getUTCMonth();
    day = date.getUTCDate();
    year = date.getUTCFullYear();
  } else {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
    if (!match) return date;
    year = Number(match[1]);
    month = Number(match[2]) - 1;
    day = Number(match[3]);
  }
  return includeYear ? `${MONTH_ABBREV[month]} ${day}, ${year}` : `${MONTH_ABBREV[month]} ${day}`;
}

// A stored season_id is "20252026" (no separator) — every page that shows
// one to a reader formats it as "2025-26" the same way, so this exists once
// instead of getting re-derived per page (schedule/page.tsx had its own
// copy before this).
export function formatSeasonLabel(seasonId: string) {
  return `${seasonId.slice(0, 4)}-${seasonId.slice(6, 8)}`;
}
