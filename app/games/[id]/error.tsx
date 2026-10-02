"use client";

// Shown when a game page can't load right now (for example the NHL feed is
// rate-limiting or down), instead of a false "not found". Not cached: the
// next visit tries again.
export default function GameError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main style={{ maxWidth: 1160, margin: "0 auto", padding: "4rem 24px", minHeight: "50vh" }}>
      <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "2.2rem", textTransform: "uppercase", margin: "0 0 .8rem" }}>This game didn&apos;t load</h1>
      <p style={{ color: "var(--text-secondary)", maxWidth: "52ch", margin: "0 0 1.4rem" }}>
        The NHL&apos;s game feed didn&apos;t answer just now. It usually comes back within seconds.
      </p>
      <button
        type="button"
        onClick={reset}
        style={{ background: "var(--gold)", color: "var(--ink)", fontWeight: 700, border: "none", borderRadius: 8, padding: "12px 22px", cursor: "pointer" }}
      >
        Try again
      </button>
    </main>
  );
}
