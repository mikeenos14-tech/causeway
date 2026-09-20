import Link from "next/link";

export function Masthead({ scoreline }: { scoreline?: React.ReactNode }) {
  return (
    <header style={{ background: "var(--ink)", color: "#f1eee5" }}>
      <div style={{ maxWidth: 1160, margin: "0 auto", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap" }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "1.7rem", color: "#f1eee5", textDecoration: "none" }}>
            <span style={{ width: 26, height: 26, borderRadius: "50%", border: "2px solid var(--gold)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ width: 8, height: 8, background: "var(--gold)", borderRadius: 2, transform: "rotate(45deg)" }} />
            </span>
            Causeway
          </Link>
          <nav style={{ display: "flex", gap: 20, fontFamily: "var(--font-display)", fontSize: "1.15rem" }}>
            <Link href="/" style={{ color: "#d8d6cc", textDecoration: "none" }}>
              Home
            </Link>
            <Link href="/schedule" style={{ color: "#d8d6cc", textDecoration: "none" }}>
              Schedule
            </Link>
            <Link href="/standings" style={{ color: "#d8d6cc", textDecoration: "none" }}>
              Standings
            </Link>
          </nav>
          <Link
            href="/ask"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 999,
              padding: "7px 16px 7px 13px",
              fontFamily: "var(--font-body)",
              fontSize: ".85rem",
              fontWeight: 600,
              color: "#f1eee5",
              textDecoration: "none",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2.4">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            Ask Causeway
          </Link>
        </div>
        {scoreline}
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer style={{ background: "var(--ink)", color: "#b7b5ad" }}>
      <div style={{ maxWidth: 1160, margin: "0 auto", padding: "1.1rem 24px", fontSize: ".8rem" }}>
        Data: NHL API, MoneyPuck.com. Causeway is an independent fan project, not affiliated with the NHL or the Boston Bruins Hockey Club.
      </div>
    </footer>
  );
}
