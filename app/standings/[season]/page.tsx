import { notFound } from "next/navigation";
import { StandingsView } from "@/components/views/StandingsView";
import { seasonFromPath } from "@/lib/season-path";

// A past season's final standings (/standings/1970-71), cached after its
// first visit.
export const revalidate = 300;
export async function generateStaticParams() {
  return [];
}

export default async function StandingsSeason({ params }: { params: Promise<{ season: string }> }) {
  const seasonId = seasonFromPath((await params).season);
  if (!seasonId) notFound();
  return <StandingsView requested={seasonId} />;
}
