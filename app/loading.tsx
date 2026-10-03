import { Masthead } from "@/components/Masthead";

// Shown the moment a link is tapped, while the next page renders on the
// server (before this, the old page sat frozen with no sign anything was
// happening). The real masthead plus soft placeholder blocks.
export default function Loading() {
  return (
    <>
      <Masthead />
      <main style={{ maxWidth: 1160, margin: "0 auto", padding: "3rem 24px 3.5rem" }} aria-busy="true" aria-label="Loading">
        <div className="skeleton" style={{ width: "38%", height: 18, marginBottom: 18 }} />
        <div className="skeleton" style={{ width: "62%", height: 48, marginBottom: 28 }} />
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))" }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" style={{ height: 120 }} />
          ))}
        </div>
        <div className="skeleton" style={{ height: 260, marginTop: 28 }} />
      </main>
    </>
  );
}
