// The fallback narration path for a game significance-checks.ts found
// nothing statistically notable about — most games, in practice (only 1 of
// the last 8 real Bruins games checked had an actual notable fact). Without
// this, most homepage visits show a bare templated headline with no voice
// at all, which doesn't match a "die-hard fan commentary site-wide" bar.
//
// Deliberately a separate function from narrateHighlights, not a shared
// one with an empty facts array: the grounding contract here is different
// and narrower. narrateHighlights grounds every claim in a list of
// pre-verified facts; this has no facts list at all — the only real,
// checkable things it's allowed to reference are the final score, teams,
// game type, and date, so its own rules have to enumerate that boundary
// directly instead of pointing at a facts array. Mixing the two into one
// prompt risks the highlights path's careful fact-grounding discipline
// leaking or loosening.

import Anthropic from "@anthropic-ai/sdk";
import { TEAM_WORDS } from "./narrate-highlights";

export type RecapResult = {
  headline: string;
  body: string;
  modelVersion: string;
};

const MODEL = "claude-haiku-4-5-20251001"; // same cost tier as narrateHighlights — short, cheap, per-game

const SYSTEM_PROMPT = `You write a short "the game happened" line for Causeway, a Boston Bruins fan site, for a game that had nothing statistically notable about it — no streak, no record, no milestone. This is NOT a highlights blurb; you have no list of verified facts to draw on, only the bare result below.

Rules, no exceptions:
- The ONLY real, verified things you know are: the final score, which team was home/away, the game type (regular season, playoff, preseason), and the date. Never state or imply anything beyond that — no streaks, no season record, no head-to-head history, no standings implication, no player-specific claim. This explicitly includes the game's position within a series or season: you are NOT told what game number this is, so never call it the "opener," "clincher," "series opener," "Game 1," a "deciding game," or any other claim about where it falls in a series — a playoff game_type tells you it's a playoff game, nothing about which one. If you don't know it from the facts given above, it is not true as far as you're concerned.
- Write like a die-hard Boston Bruins fan with a dry, understated sense of humor about an ordinary game — this is the "nothing to write home about, but it's still our team" register, not a highlight reel. Real personality is welcome; manufactured excitement about a routine result is not. A blowout win, a deflating loss, and an unremarkable 3-2 game should not read the same — let the actual score margin inform the tone (close game vs. lopsided), since that much you genuinely know.
- 1-2 sentences. Shorter than a highlights blurb — there's less to say, so don't pad it out.
- Sentence case, no exclamation points, no hype-speak clichés ("incredible", "amazing"), no Markdown.
- Output ONLY strict JSON, no markdown code fence, no commentary before or after: {"headline": "...", "body": "..."}. Headline is under 10 words. Body is the actual line.`;

export async function narrateRecap(gameContext: {
  homeAbbrev: string;
  awayAbbrev: string;
  homeScore: number;
  awayScore: number;
  gameDate: string;
  gameType: string;
}): Promise<RecapResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Spelled out explicitly rather than relying on "@" shorthand — found
  // live: with the terser notation, the model sometimes said a Boston home
  // game happened "in Buffalo" (the away team's city), getting the venue
  // backwards despite the home/away data being technically present.
  const userPrompt = `HOME team: ${gameContext.homeAbbrev} (this game was played at the home team's arena), score ${gameContext.homeScore}
AWAY team: ${gameContext.awayAbbrev}, score ${gameContext.awayScore}
Date: ${gameContext.gameDate}
Game type: ${gameContext.gameType}

Write the line now, as JSON only.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const rawText = response.content.find((b) => b.type === "text")?.text ?? "";
  // Same defense-in-depth as narrateHighlights: don't rely solely on the
  // prompt instruction to skip markdown fencing.
  const text = rawText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  let parsed: { headline: string; body: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Model did not return valid JSON: ${rawText.slice(0, 200)}`);
  }
  if (!parsed.headline || !parsed.body) {
    throw new Error(`Model response missing headline or body: ${text.slice(0, 200)}`);
  }

  // Same "validate the output, don't just instruct" pattern as
  // narrateHighlights: reject a body that invents a streak/record claim
  // despite the explicit rule against it, rather than trust the prompt
  // alone to hold every time.
  const combined = `${parsed.headline} ${parsed.body}`.toLowerCase();
  const fabricationPatterns = [
    /\bstreak\b/, /\brecord\b/, /\bmeetings?\b/, /\bsince \d{4}\b/, /\bfirst time\b/, /\bmilestone\b/,
    // Series/season-position claims — found live: a game that was actually
    // the 6th and last of a series got called the "playoff opener," a
    // confident, plausible-sounding, and entirely fabricated claim, since
    // this function is never told what game number it is.
    /\bopener\b/, /\bclincher\b/, /\bdeciding game\b/, /\belimination game\b/,
    /\bgame (one|two|three|four|five|six|seven|1|2|3|4|5|6|7)\b/, /\bseries[- ]opening\b/,
  ];
  const hit = fabricationPatterns.find((re) => re.test(combined));
  if (hit) {
    throw new Error(`Recap invented an unverified historical claim (matched ${hit}) — this path has no facts to ground that in: ${combined.slice(0, 200)}`);
  }

  // Venue check — found live (before the prompt rewrite above): a Boston
  // home game got narrated as happening "in Buffalo," the away team's
  // city, getting the location backwards. Reject "in <away city>" as a
  // location claim; a legitimate mention of the away team ("Buffalo's
  // offense") doesn't match this "in <city>" shape, so this shouldn't
  // false-positive on normal team references.
  const awayCityWords = TEAM_WORDS[gameContext.awayAbbrev] ?? [];
  const homeCityWords = new Set(TEAM_WORDS[gameContext.homeAbbrev] ?? []);
  const wrongVenue = awayCityWords.find((w) => !homeCityWords.has(w) && new RegExp(`\\bin ${w}\\b`, "i").test(combined));
  if (wrongVenue) {
    throw new Error(`Recap places the game "in ${wrongVenue}" (the away team's city), but ${gameContext.homeAbbrev} was actually home: ${combined.slice(0, 200)}`);
  }

  return { headline: parsed.headline, body: parsed.body, modelVersion: MODEL };
}
