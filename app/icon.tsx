import { ImageResponse } from "next/og";
import { BannerMark } from "@/components/BannerMark";

// Browser tab icon: the simplified banner mark (no stripes or rod), which
// stays legible at 16-32px. Same mark family as the header.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: "#0a0a0b", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <BannerMark variant="micro" width={25} />
      </div>
    ),
    size,
  );
}
