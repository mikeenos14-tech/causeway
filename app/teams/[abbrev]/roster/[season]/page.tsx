import { notFound } from "next/navigation";
import { RosterView } from "@/components/views/RosterView";
import { seasonFromPath } from "@/lib/season-path";

// A past season's roster (/teams/BOS/roster/2010-11), cached after its
// first visit.
export const revalidate = 300;
export async function generateStaticParams() {
  return [];
}

export default async function TeamRosterSeason({ params }: { params: Promise<{ abbrev: string; season: string }> }) {
  const { abbrev, season } = await params;
  const seasonId = seasonFromPath(season);
  if (!seasonId) notFound();
  return <RosterView rawAbbrev={abbrev} requested={seasonId} />;
}
