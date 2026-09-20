// Bruins headlines via Google News' public RSS search feed — no API key,
// but their own feed copyright notice restricts it to "personal,
// non-commercial use" in a "personal feed reader," which a public site
// doesn't strictly match (a real constraint worth knowing, not a hard
// blocker for a small non-commercial fan project — common practice, but
// disclosed here rather than silently assumed away).
//
// Fetched live at request time, not backfilled — news is exactly the
// kind of data that goes stale in a way box scores don't, so this is
// cached only briefly (see revalidate on the fetch call) rather than
// stored.

export type Headline = {
  title: string;
  source: string;
  link: string;
  publishedAt: string; // ISO string
};

const FEED_URL = "https://news.google.com/rss/search?q=%22Boston%20Bruins%22%20when:7d&hl=en-US&gl=US&ceid=US:en";

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function extractTag(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(block);
  if (!match) return null;
  // RSS text fields are sometimes CDATA-wrapped, sometimes not — strip
  // the wrapper if present rather than assuming either way.
  const raw = match[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
  return decodeEntities(raw.trim());
}

// Google News titles are "Real Title - Source Name" — the same source
// the <source> tag already gives cleanly, so strip the duplicate suffix
// for a title that doesn't repeat itself when both are shown together.
function stripSourceSuffix(title: string, source: string): string {
  const suffix = ` - ${source}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length) : title;
}

export async function getBruinsHeadlines(): Promise<Headline[]> {
  let res: Response;
  try {
    res = await fetch(FEED_URL, {
      next: { revalidate: 1800 }, // 30 min — news changes fast enough that a day-long cache would feel stale, but not so fast that per-request fetching is worth it
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CausewayBot/1.0)" },
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];

  const xml = await res.text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const headlines: Headline[] = [];
  for (const item of items) {
    const rawTitle = extractTag(item, "title");
    const link = extractTag(item, "link");
    const pubDate = extractTag(item, "pubDate");
    const sourceMatch = /<source[^>]*>([\s\S]*?)<\/source>/.exec(item);
    const source = sourceMatch ? decodeEntities(sourceMatch[1].trim()) : "";
    if (!rawTitle || !link || !pubDate) continue;

    // pubDate is RFC 822 with an explicit GMT/offset marker ("Sat, 19 Sep
    // 2026 19:26:51 GMT") — unlike a bare "YYYY-MM-DD" date, that's
    // unambiguous for the Date constructor to parse directly.
    const publishedDate = new Date(pubDate);
    if (Number.isNaN(publishedDate.getTime())) continue;
    // Defensive filter in code too — the when:7d in the query already
    // asks Google for this, but don't just trust the upstream filter
    // blindly when it costs nothing to check ourselves.
    if (publishedDate.getTime() < sevenDaysAgo) continue;

    headlines.push({
      title: stripSourceSuffix(rawTitle, source),
      source: source || "Unknown source",
      link,
      publishedAt: publishedDate.toISOString(),
    });
  }

  headlines.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  return headlines;
}
