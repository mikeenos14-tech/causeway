import Link from "next/link";
import { BannerMark } from "@/components/BannerMark";

export function Masthead({ scoreline }: { scoreline?: React.ReactNode }) {
  return (
    <header style={{ background: "var(--ink)", color: "#f1eee5" }}>
      {/* One row on desktop. On phones: logo and Ask share the top row and
          the section links become a single side-scrolling row, instead of
          wrapping into three stacked rows (~260px of chrome with the team
          sub-nav before any content). */}
      <div className="masthead-inner" style={{ maxWidth: 1160, margin: "0 auto", padding: "14px 24px" }}>
        <Link href="/" className="masthead-logo" style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "1.7rem", color: "#f1eee5", textDecoration: "none" }}>
          {/* Raised into the rafters once per visit (see globals.css and the
              script in app/layout.tsx); still for reduced-motion users. */}
          <span className="banner-raise-wrap">
            <span className="banner-raise">
              <BannerMark width={28} />
            </span>
          </span>
          Causeway
        </Link>
        <nav className="masthead-nav" style={{ fontFamily: "var(--font-display)", fontSize: "1.15rem" }}>
          <Link href="/" style={{ color: "#d8d6cc", textDecoration: "none" }}>
            Home
          </Link>
          <Link href="/schedule" style={{ color: "#d8d6cc", textDecoration: "none" }}>
            Schedule
          </Link>
          <Link href="/standings" style={{ color: "#d8d6cc", textDecoration: "none" }}>
            Standings
          </Link>
          <Link href="/headlines" style={{ color: "#d8d6cc", textDecoration: "none" }}>
            Headlines
          </Link>
        </nav>
        <Link
          href="/ask"
          className="masthead-ask"
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
            whiteSpace: "nowrap",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2.4" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          Ask Causeway
        </Link>
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
