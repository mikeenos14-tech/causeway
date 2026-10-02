import Link from "next/link";

// Roster and Advanced are one tab with two views: standard box-score stats
// and MoneyPuck's expected goals / possession. Plain links, so each view
// keeps its own URL (old /advanced links still land on the right view).
export function RosterViewToggle({ abbrev, view }: { abbrev: string; view: "standard" | "advanced" }) {
  const item = (active: boolean) => ({
    padding: "6px 14px",
    fontSize: ".82rem",
    fontWeight: 600,
    textDecoration: "none",
    borderRadius: 999,
    color: active ? "var(--ink)" : "var(--text-secondary)",
    background: active ? "var(--gold)" : "transparent",
  });
  return (
    <nav aria-label="Roster view" style={{ display: "inline-flex", gap: 2, padding: 3, border: "1px solid var(--border)", borderRadius: 999, marginBottom: "1.25rem" }}>
      <Link href={`/teams/${abbrev}/roster`} aria-current={view === "standard" ? "page" : undefined} style={item(view === "standard")}>
        Standard
      </Link>
      <Link href={`/teams/${abbrev}/advanced`} aria-current={view === "advanced" ? "page" : undefined} style={item(view === "advanced")}>
        Advanced
      </Link>
    </nav>
  );
}
