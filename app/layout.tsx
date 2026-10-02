import type { Metadata } from "next";
import { Teko, Source_Serif_4, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const teko = Teko({
  variable: "--font-display",
  weight: ["500", "600", "700"],
  subsets: ["latin"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-editorial",
  weight: ["500", "600"],
  subsets: ["latin"],
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-body",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

// Link previews need absolute image URLs. Vercel sets the production
// domain; previews and local dev fall back to their own host.
const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Causeway",
  description: "A stats-first Boston Bruins fan hub. Bruins history since 1924.",
  openGraph: { siteName: "Causeway", type: "website" },
  twitter: { card: "summary_large_image" },
  appleWebApp: {
    capable: true,
    title: "Causeway",
    statusBarStyle: "black-translucent",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the banner script below sets
    // data-banner-raised on <html> before React hydrates (by design).
    <html
      lang="en"
      suppressHydrationWarning
      className={`${teko.variable} ${sourceSerif.variable} ${plexSans.variable} h-full antialiased`}
    >
      <head>
        {/* The header banner rises once per visit: the first full page load
            plays it, and the data-banner-raised flag (set after it finishes,
            or right away on later loads this session) stops it replaying on
            every navigation. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var k="causeway-banner-raised",d=document.documentElement;if(sessionStorage.getItem(k)){d.dataset.bannerRaised="1"}else{sessionStorage.setItem(k,"1");setTimeout(function(){d.dataset.bannerRaised="1"},1600)}}catch(e){document.documentElement.dataset.bannerRaised="1"}`,
          }}
        />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
