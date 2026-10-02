import { ImageResponse } from "next/og";
import { getGameDetail } from "@/lib/game-detail-data";
import { getHistoryGame, BOX_SCORES_FROM } from "@/lib/history-data";
import { formatGameDate } from "@/lib/format-date";
import { formatStartTimeET } from "@/lib/nhl-schedule";
import { OgFrame, OG_SIZE, GOLD, MUTED, clip } from "@/lib/og-card";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Causeway game card";

// What a game link looks like when shared: the final score and the recap
// headline once the game is in our database, or the matchup and puck drop
// before it. Any league game works, same as the page.
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const gameId = Number((await params).id);
  let game = Number.isInteger(gameId) ? await getGameDetail(gameId).catch(() => null) : null;
  // Before 2007-08: the history tables, in the same final-score card.
  if (!game && Number.isInteger(gameId)) {
    const h = await getHistoryGame(gameId).catch(() => null);
    if (h && h.season < BOX_SCORES_FROM) {
      game = {
        game_date: h.date,
        game_end_type: h.finalState === "OT" ? "overtime" : h.finalState === "SO" ? "shootout" : "regulation",
        home_abbrev: h.home.code,
        away_abbrev: h.away.code,
        home_score: h.home.score,
        away_score: h.away.score,
        headline: h.iconic?.label ?? h.stage ?? null,
        body: h.iconic?.story ?? null,
      };
    }
  }

  if (game) {
    const awayWon = game.away_score > game.home_score;
    const homeWon = game.home_score > game.away_score; // neither, for a tie
    const end = game.home_score === game.away_score ? " (Tie)" : game.game_end_type === "overtime" ? " (OT)" : game.game_end_type === "shootout" ? " (SO)" : "";
    const team = (abbrev: string, score: number, won: boolean) => (
      <div style={{ display: "flex", alignItems: "baseline", gap: 28, color: won ? "#f5f5f4" : MUTED }}>
        <div style={{ display: "flex", fontSize: 96, fontWeight: 800, letterSpacing: 2 }}>{abbrev}</div>
        <div style={{ display: "flex", fontSize: 150, fontWeight: 800, lineHeight: 1 }}>{String(score)}</div>
      </div>
    );
    return new ImageResponse(
      (
        <OgFrame label={`Final${end} · ${formatGameDate(game.game_date, true)}`} footer={game.body ? clip(game.body, 110) : undefined}>
          <div style={{ display: "flex", alignItems: "center", gap: 56 }}>
            {team(game.away_abbrev, game.away_score, awayWon)}
            <div style={{ display: "flex", fontSize: 60, color: MUTED }}>@</div>
            {team(game.home_abbrev, game.home_score, homeWon)}
          </div>
          {game.headline && <div style={{ display: "flex", fontSize: 46, fontWeight: 700, color: GOLD, marginTop: 24 }}>{clip(game.headline, 60)}</div>}
        </OgFrame>
      ),
      size,
    );
  }

  // Not loaded yet: the matchup from the NHL's feed.
  let away = "", home = "", when = "", venue = "";
  try {
    const res = await fetch(`https://api-web.nhle.com/v1/gamecenter/${gameId}/landing`, { next: { revalidate: 300 } });
    if (res.ok) {
      const d = await res.json();
      away = d.awayTeam?.abbrev ?? "";
      home = d.homeTeam?.abbrev ?? "";
      when = d.startTimeUTC ? formatStartTimeET(d.startTimeUTC) : "";
      venue = d.venue?.default ?? "";
    }
  } catch {
    // fall through to the generic card
  }
  return new ImageResponse(
    (
      <OgFrame label="Game preview" footer={venue || undefined}>
        <div style={{ fontSize: 130, fontWeight: 800, lineHeight: 1, letterSpacing: 2 }}>{away && home ? `${away} at ${home}` : "Game preview"}</div>
        {when && <div style={{ fontSize: 46, fontWeight: 700, color: GOLD, marginTop: 24 }}>{when}</div>}
      </OgFrame>
    ),
    size,
  );
}
