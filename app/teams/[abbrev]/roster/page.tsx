import { RosterView } from "@/components/views/RosterView";

// The current roster, cached 5 minutes (rosters sync hourly).
export const revalidate = 300;
export async function generateStaticParams() {
  return [];
}

export default async function TeamRoster({ params }: { params: Promise<{ abbrev: string }> }) {
  return <RosterView rawAbbrev={(await params).abbrev} />;
}
