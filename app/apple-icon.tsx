import { ImageResponse } from "next/og";
import { ZakimMark } from "@/components/ZakimMark";

// The icon iOS uses for "Add to Home Screen" (180x180): the Zakim C on
// black, with room around it for iOS's rounded corners.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: "#0a0a0b", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <ZakimMark size={136} />
      </div>
    ),
    size,
  );
}
