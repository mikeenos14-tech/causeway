import { notFound } from "next/navigation";
import { getTeam } from "@/lib/homepage-data";
import { Masthead, Footer } from "@/components/Masthead";
import { TeamSubNav } from "@/components/TeamSubNav";
import { TeamDashboard } from "@/components/TeamDashboard";
import { TeamLogo } from "@/components/TeamLogo";

export const revalidate = 300;

// No pages prebuilt at deploy; each renders on its first visit and is then
// cached for the revalidate period above. A route with a [param] segment
// ignores revalidate unless this is declared (found 2026-10-02: every
// team page was rendering from scratch on every visit, 0.5-0.9 s).
export async function generateStaticParams() {
  return [];
}

// Any team's overview — the same dashboard as the homepage, in compact form
// under the team's name. Season logic (which season each module shows, and
// when it flips) lives in TeamDashboard.
export default async function TeamDetail({ params }: { params: Promise<{ abbrev: string }> }) {
  const { abbrev: rawAbbrev } = await params;
  const abbrev = rawAbbrev.toUpperCase();

  const team = await getTeam(abbrev);
  if (!team) notFound();

  return (
    <>
      <Masthead />
      <main style={{ maxWidth: 1160, margin: "0 auto", padding: "1.5rem 24px 3.5rem" }}>
        <TeamSubNav abbrev={abbrev} />
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.4rem,5.5vw,4rem)", lineHeight: 0.98, textTransform: "uppercase", letterSpacing: ".01em", margin: "0 0 .5rem", display: "flex", alignItems: "center", gap: 6 }}>
          <TeamLogo abbrev={abbrev} size={64} gap={6} />
          {team.name}
        </h1>
        <TeamDashboard abbrev={abbrev} compact />
      </main>
      <Footer />
    </>
  );
}
