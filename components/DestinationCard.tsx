import Link from "next/link";

// A link to another page, styled as a card so it reads as a place to go:
// title, a one-line teaser with a real number, and an arrow. The whole
// card is the link. (Pill chips on this site are filters; cards are
// destinations.)
export function DestinationCard({ href, title, teaser }: { href: string; title: string; teaser: string }) {
  return (
    <Link href={href} className="dest-card">
      <span className="dest-card-title">
        {title}
        <span className="dest-card-arrow" aria-hidden="true">
          →
        </span>
      </span>
      <span className="dest-card-teaser">{teaser}</span>
    </Link>
  );
}
