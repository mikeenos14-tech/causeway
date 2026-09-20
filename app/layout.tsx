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

export const metadata: Metadata = {
  title: "Causeway",
  description: "A stats-first Boston Bruins fan hub.",
  appleWebApp: {
    capable: true,
    title: "Causeway",
    statusBarStyle: "black-translucent",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${teko.variable} ${sourceSerif.variable} ${plexSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
