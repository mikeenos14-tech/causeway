import { ScheduleView } from "@/components/views/ScheduleView";

// The current season, cached 5 minutes like every other data page.
export const revalidate = 300;

export default function Schedule() {
  return <ScheduleView />;
}
