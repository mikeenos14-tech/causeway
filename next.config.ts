import type { NextConfig } from "next";

// Old ?season=YYYYYYYY links (shared, bookmarked) to the path form the
// season pages use now (lib/season-path.ts): "?season=20102011" ->
// "/2010-11". Permanent, so browsers and search engines update.
const SEASON = { type: "query" as const, key: "season", value: "(?<a>\\d{4})\\d{2}(?<b>\\d{2})" };

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/schedule", has: [SEASON], destination: "/schedule/:a-:b", permanent: true },
      { source: "/standings", has: [SEASON], destination: "/standings/:a-:b", permanent: true },
      { source: "/teams/:abbrev/roster", has: [SEASON], destination: "/teams/:abbrev/roster/:a-:b", permanent: true },
    ];
  },
  images: {
    // Official NHL headshots (player_headshots). The originals are 336px
    // PNGs of ~100-200 KB; the optimizer serves list thumbnails at a few KB.
    remotePatterns: [{ protocol: "https", hostname: "assets.nhle.com", pathname: "/mugs/nhl/**" }],
    // A player's photo changes at most once a season; cache a month so the
    // whole league's photos are resized about once a month, not daily.
    minimumCacheTTL: 2678400,
  },
};

export default nextConfig;
