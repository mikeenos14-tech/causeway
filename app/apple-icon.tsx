import { ImageResponse } from "next/og";

// This is the one iOS actually uses for "Add to Home Screen" — same mark
// as the header logo, scaled up to Apple's recommended 180x180.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0a0a0b",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 130,
            height: 130,
            borderRadius: "50%",
            border: "10px solid #ffb81c",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              background: "#ffb81c",
              borderRadius: 10,
              transform: "rotate(45deg)",
            }}
          />
        </div>
      </div>
    ),
    { ...size },
  );
}
