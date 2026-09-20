import { ImageResponse } from "next/og";

// Same mark as the header logo (components/Masthead.tsx) — a gold-ringed
// circle with a rotated gold square inside — rendered as a real image so
// it can serve as the browser tab favicon and the generic PWA icon.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
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
            width: 26,
            height: 26,
            borderRadius: "50%",
            border: "2px solid #ffb81c",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 9,
              height: 9,
              background: "#ffb81c",
              borderRadius: 2,
              transform: "rotate(45deg)",
            }}
          />
        </div>
      </div>
    ),
    { ...size },
  );
}
