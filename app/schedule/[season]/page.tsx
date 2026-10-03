import { notFound } from "next/navigation";
import { ScheduleView } from "@/components/views/ScheduleView";
import { seasonFromPath } from "@/lib/season-path";

// A past season (/schedule/2010-11), cached after its first visit.
export const revalidate = 300;
export async function generateStaticParams() {
  return [];
}

export default async function ScheduleSeason({ params }: { params: Promise<{ season: string }> }) {
  const seasonId = seasonFromPath((await params).season);
  if (!seasonId) notFound();
  return <ScheduleView requested={seasonId} />;
}
