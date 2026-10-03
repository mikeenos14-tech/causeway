import type { Metadata } from "next";
import { Teko, Source_Serif_4, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { RefreshOnReturn } from "@/components/RefreshOnReturn";

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
    <html lang="en" className={`${teko.variable} ${sourceSerif.variable} ${plexSans.variable} h-full antialiased`}>
      <body className="min-h-full">
        {children}
        <RefreshOnReturn />
      </body>
    </html>
  );
}
