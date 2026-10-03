import Link from "next/link";
import { ZakimMark } from "@/components/ZakimMark";
import { SiteSearch } from "@/components/SiteSearch";

export function Masthead({ scoreline }: { scoreline?: React.ReactNode }) {
  return (
    <header style={{ background: "var(--ink)", color: "#f1eee5" }}>
      {/* One row on desktop. On phones: logo and Ask share the top row and
          the section links become a single side-scrolling row, instead of
          wrapping into three stacked rows (~260px of chrome with the team
          sub-nav before any content). */}
      <div className="masthead-inner" style={{ maxWidth: 1160, margin: "0 auto", padding: "14px 24px" }}>
        <Link href="/" className="masthead-logo" style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "1.7rem", color: "#f1eee5", textDecoration: "none" }}>
          {/* The Zakim C (owner's design, 2026-10-02). */}
          <ZakimMark size={40} />
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
            {/* Capitals with open tracking, as in the logo file. */}
            <span className="masthead-wordmark" style={{ textTransform: "uppercase", letterSpacing: ".04em" }}>Causeway</span>
            {/* The approved full lockup: the first game on file is Dec 1, 1924. */}
            <span className="masthead-tagline">
              {/* Phones get the short form so the search button keeps its row. */}
              <span className="tagline-long">Bruins history </span>since 1924
            </span>
          </span>
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
          <Link href="/history" style={{ color: "#d8d6cc", textDecoration: "none" }}>
            History
          </Link>
          {/* The signature feature gets its own spot (and the gold), not
              just the search box's "or ask". */}
          <Link href="/ask" style={{ color: "var(--gold)", textDecoration: "none" }}>
            Ask
          </Link>
          {/* "News", not "Headlines": short enough that all six links fit
              on a phone without hiding Home (users looked for it). */}
          <Link href="/headlines" style={{ color: "#d8d6cc", textDecoration: "none" }}>
            News
          </Link>
        </nav>
        <SiteSearch />
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
