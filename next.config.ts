import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
