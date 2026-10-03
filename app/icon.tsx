import { ImageResponse } from "next/og";
import { ZakimMark } from "@/components/ZakimMark";

// Browser tab icon: the Zakim C's small-size cut (heavier lines, two cables
// a side), which stays legible at 16-32px. Same mark as the header.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: "#0a0a0b", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <ZakimMark variant="micro" size={31} />
      </div>
    ),
    size,
  );
}
