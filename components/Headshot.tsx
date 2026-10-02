import Image from "next/image";

// A player's official NHL headshot, cropped to a circle on the card colour.
// Only players on a current NHL roster have one (player_headshots, synced
// daily); everyone else gets their initials, so lists keep their rhythm.
//
// The NHL's photos are head-and-shoulders, so at list sizes the face would
// be a few pixels wide; the image is drawn larger than the circle and
// shifted so the circle frames the face.

export function Headshot({ url, name, size = 32, zoom = 1.45, eager = false }: { url: string | null | undefined; name: string; size?: number; zoom?: number; eager?: boolean }) {
  const circle = {
    width: size,
    height: size,
    borderRadius: "50%",
    flexShrink: 0,
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    overflow: "hidden",
    position: "relative" as const,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
  if (!url) {
    const initials = name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
    return (
      <span aria-hidden="true" style={{ ...circle, fontSize: Math.round(size * 0.36), fontWeight: 700, color: "var(--text-muted)" }}>
        {initials}
      </span>
    );
  }
  const drawn = Math.round(size * zoom);
  return (
    <span aria-hidden="true" style={circle}>
      <Image
        src={url}
        alt=""
        width={drawn}
        height={drawn}
        loading={eager ? "eager" : "lazy"}
        style={{ position: "absolute", width: drawn, height: drawn, maxWidth: "none", left: Math.round((size - drawn) / 2), top: Math.round(size * -0.08 * (zoom - 1) / 0.45) }}
      />
    </span>
  );
}
