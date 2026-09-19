// Turns the grounded facts from significance-checks.ts into a short,
// natural "what stood out" blurb. This step never decides WHAT is
// notable — that's the checks' job, and every fact it's given is already
// real. Its only jobs are: pick the best 2-3 if there are more, and write
// them up the way a knowledgeable friend would text it to you.

import Anthropic from "@anthropic-ai/sdk";
import type { SignificanceFact } from "./significance-checks";

export type HighlightResult = {
  headline: string;
  body: string;
  modelVersion: string;
};

const MODEL = "claude-haiku-4-5-20251001"; // this is a short, cheap, per-game task — no need for a larger model

// Used only to tell a legitimate team reference ("Boston's win," "the
// Canucks") apart from a fabricated player name — not an allowlist of every
// possible team the site will ever cover, just the words that could show up
// in a possessive next to a team's own name. A couple of common nicknames
// ("Habs," "Caps") are included because real generated headlines already
// used them tonight.
export const TEAM_WORDS: Record<string, string[]> = {
  ANA: ["anaheim", "ducks"], ARI: ["arizona", "coyotes"], ATL: ["atlanta", "thrashers"],
  BOS: ["boston", "bruins"], BUF: ["buffalo", "sabres"], CAR: ["carolina", "hurricanes"],
  CBJ: ["columbus", "blue", "jackets"], CGY: ["calgary", "flames"], CHI: ["chicago", "blackhawks"],
  COL: ["colorado", "avalanche"], DAL: ["dallas", "stars"], DET: ["detroit", "red", "wings"],
  EDM: ["edmonton", "oilers"], FLA: ["florida", "panthers"], LAK: ["los", "angeles", "kings"],
  MIN: ["minnesota", "wild"], MTL: ["montreal", "montréal", "canadiens", "habs"],
  NJD: ["new", "jersey", "devils"], NSH: ["nashville", "predators"], NYI: ["new", "york", "islanders"],
  NYR: ["new", "york", "rangers"], OTT: ["ottawa", "senators"], PHI: ["philadelphia", "flyers"],
  PHX: ["phoenix", "coyotes"], PIT: ["pittsburgh", "penguins"], SEA: ["seattle", "kraken"],
  SJS: ["san", "jose", "sharks"], STL: ["st", "louis", "blues"], TBL: ["tampa", "bay", "lightning"],
  TOR: ["toronto", "maple", "leafs"], UTA: ["utah", "mammoth"], VAN: ["vancouver", "canucks"],
  VGK: ["vegas", "golden", "knights"], WPG: ["winnipeg", "jets"], WSH: ["washington", "capitals", "caps"],
};
// Common pronouns/determiners that legitimately start a sentence and can
// coincidentally precede one of the action verbs above ("He couldn't...",
// "That's the kind of...", "Both saw their streaks end") — found by
// auditing every already-stored highlight against this check before
// trusting it: 122 of 123 initial "violations" were exactly this false
// positive, not real fabrications. Only real proper names should ever
// reach the rejection branch.
const GENERIC_ALLOWED_WORDS = [
  "tonight", "today", "that", "this", "these", "those", "it", "he", "she", "they", "both", "there",
];

const SYSTEM_PROMPT = `You write short "what stood out" blurbs for Causeway, a Boston Bruins fan site, based on a list of statistical facts about a single game.

Rules, no exceptions:
- Use ONLY the facts you're given. Never state a number, date, or claim that isn't explicitly in the input. Do not infer, estimate, or embellish. This rule is absolute and overrides everything else below about voice and humor — a joke or a die-hard aside is never grounds to bend, round, or reinterpret a fact.
- If there are more than 3 facts, pick the 2-3 most genuinely interesting ones. Rarer/harder-to-repeat things beat common ones.
- If there's only 1 fact, write about just that one — don't pad it out.
- Write like a die-hard Boston Bruins fan who's also sharp with the numbers — texting a fellow fan something cool they noticed, not filing a press release. Let real personality and dry humor show: a little chirp at a rival, a wry aside about Boston sports heartbreak, genuine excitement when it's earned. This is a voice, not a gimmick — the humor should feel like an aside a real fan would make, never a pun forced into the sentence, never at the cost of clarity. Every game gets this same voice; don't save it only for wins or blowouts. Sentence case, no exclamation points, no hype-speak clichés ("incredible", "amazing").
- Preserve exactly what a fact is counting. If a fact says "the Nth game," do not rewrite it as "the Nth player" or "the Nth time [someone] has done this" — those are different claims. Keep numbers attached to the same noun they came with.
- A "point_streak_extending" fact means the streak is STILL ACTIVE right now — the player just extended it in this game. Never say it "ended," "snapped," "was broken," or similar, even if the team lost this game. The team losing and the individual streak continuing are unrelated facts — do not let one bleed into the other. Only a "point_streak_snapped" fact means a streak ended.
- Never mention a player who is not named in the facts you were given. Do not fill in a plausible-sounding teammate or invent a second data point for someone else — if only one player's fact is in the input, the blurb is about that one player only.
- A head-to-head fact only tells you a NUMBER OF MEETINGS (e.g. "in 20 meetings"), never a calendar year or a span of time. Do not translate that into "since [year]," "a decade," "four decades," or any other real-world date or duration — you do not actually know what year that count corresponds to, and guessing one from your own knowledge is fabrication, not narration. State the meeting count exactly as given, or don't mention it at all.
- Keep it to 2-4 sentences total.
- Output ONLY strict JSON, no markdown code fence, no commentary before or after: {"headline": "...", "body": "..."}. Headline is under 10 words. Body is the actual blurb.`;

export async function narrateHighlights(
  gameContext: { homeAbbrev: string; awayAbbrev: string; homeScore: number; awayScore: number; gameDate: string },
  facts: SignificanceFact[],
): Promise<HighlightResult> {
  if (facts.length === 0) {
    throw new Error("narrateHighlights called with zero facts — caller should skip narration entirely, not call this.");
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const userPrompt = `Game: ${gameContext.awayAbbrev} ${gameContext.awayScore} @ ${gameContext.homeAbbrev} ${gameContext.homeScore}, ${gameContext.gameDate}

Facts found (each already verified real, from the database):
${facts.map((f, i) => `${i + 1}. [${f.category}] ${f.fact}`).join("\n")}

Write the blurb now, as JSON only.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 500, // 300 truncated mid-response on a real 2-fact game, breaking its JSON — found via a real batch failure, not sized in advance
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const rawText = response.content.find((b) => b.type === "text")?.text ?? "";
  // Defense in depth: don't rely solely on the prompt instruction to skip
  // markdown fencing — a real test call wrapped its JSON in ```json ...```
  // despite being told not to, so strip fences before parsing rather than
  // just hoping the instruction holds every time.
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

  // Defense in depth, again: a real batch run produced a headline saying a
  // streak "snapped" for a game whose only fact was point_streak_extending
  // (still active) — the model saw the team lost that game and let that
  // bleed into the streak claim, flatly contradicting its own grounding.
  // A prompt rule alone didn't prevent this the first time, so don't trust
  // it alone here either: reject the output if it contradicts what it was
  // actually given, rather than silently store a false claim.
  const hasExtendingFact = facts.some((f) => f.category === "point_streak_extending");
  const hasSnappedFact = facts.some((f) => f.category === "point_streak_snapped");
  if (hasExtendingFact && !hasSnappedFact) {
    const combined = `${parsed.headline} ${parsed.body}`.toLowerCase();
    // Word-boundary regexes, not plain substring matches — a first pass at
    // this used .includes("ends"), which also matches inside "extends,"
    // the exact word this text is expected to use. Caught by re-checking
    // the fix's own output against real stored headlines before trusting
    // it, not by inspection.
    const contradictionPatterns = [
      /\bsnap(?:ped|s)?\b/,
      /\bended?\b/,
      /\bcomes? to an end\b/,
      /\bcame to an end\b/,
      /\bbrok(?:e|en)\b/,
      /\bstopp?ed\b/,
      /\bhalted\b/,
    ];
    const hit = contradictionPatterns.find((re) => re.test(combined));
    if (hit) {
      throw new Error(
        `Narration contradicts a point_streak_extending fact (matched ${hit}, implying the streak ended): ${combined.slice(0, 200)}`,
      );
    }
  }

  // Third distinct hallucination pattern found in the same batch run: a
  // head_to_head_shutout fact only ever says "in N meetings" — no year, no
  // duration. The model still wrote "since 2001" and, in another game,
  // "nearly four-decade shutout drought," pulling a specific calendar claim
  // from its own training data rather than the actual input. Neither of
  // those years/spans exist anywhere in the facts. Reject any 4-digit year
  // or decade-language in the output that isn't literally present in the
  // facts text — the same "validate the output, don't just instruct" fix
  // as the streak-polarity case, applied to a different failure shape.
  const hasHeadToHeadFact = facts.some((f) => f.category === "head_to_head_shutout");
  if (hasHeadToHeadFact) {
    const combined = `${parsed.headline} ${parsed.body}`;
    const factsText = facts.map((f) => f.fact).join(" ");
    const years = combined.match(/\b(19|20)\d{2}\b/g) ?? [];
    const fabricatedYear = years.find((y) => !factsText.includes(y));
    if (fabricatedYear) {
      throw new Error(`Narration invented a year (${fabricatedYear}) not present in the facts: ${combined.slice(0, 200)}`);
    }
    if (/\bdecades?\b/i.test(combined)) {
      throw new Error(`Narration invented a time span ("decade") not present in the facts: ${combined.slice(0, 200)}`);
    }
  }

  // Fourth hallucination pattern, confirmed twice in the same batch: the
  // model naming a player who appears nowhere in the facts — once inventing
  // a third player's streak alongside two real ones, once attributing a
  // team-level shutout fact (which names no player at all) to "Swayman"
  // specifically. First attempt at this check only matched the possessive
  // form ("Pastrnak's...") and missed the Swayman case entirely, because
  // that one used the bare name as a sentence subject ("Swayman shut
  // down..."), not a possessive — caught only by testing the fix against
  // both real cases before trusting it, not by inspection. Broadened to
  // also match a capitalized word immediately followed by a hockey-action
  // verb, which is deliberately narrower than "every capitalized word"
  // (that version false-positived on ordinary sentence words like
  // "Pretty") — this targets the actual failure shape (a name acting as
  // the subject of a play-by-play sentence) instead.
  const factsTextLower = facts.map((f) => f.fact).join(" ").toLowerCase();
  const allowedTeamWords = [
    ...(TEAM_WORDS[gameContext.homeAbbrev] ?? []),
    ...(TEAM_WORDS[gameContext.awayAbbrev] ?? []),
    gameContext.homeAbbrev.toLowerCase(),
    gameContext.awayAbbrev.toLowerCase(),
  ];
  const ACTION_VERBS =
    "shut|scored?|recorded?|extended?|hits?|notched?|lit|went|had|posted?|snapped|couldn.t|picked|reached|earned|tied|broke|delivered|chipped|stayed|kept|joined|goes|keeps|didn.t|wasn.t|isn.t";
  const namePattern = new RegExp(`\\b([A-Z][a-zA-Z]+)(?:'s\\b|\\s+(?:${ACTION_VERBS})\\b)`, "g");
  const combinedText = `${parsed.headline} ${parsed.body}`;
  const candidateNames = new Set([...combinedText.matchAll(namePattern)].map((m) => m[1]));
  for (const name of candidateNames) {
    const lower = name.toLowerCase();
    if (factsTextLower.includes(lower)) continue;
    if (allowedTeamWords.includes(lower)) continue;
    if (GENERIC_ALLOWED_WORDS.includes(lower)) continue;
    throw new Error(`Narration mentions "${name}" who is not named in the facts, the teams, or the allowed word list.`);
  }

  return { headline: parsed.headline, body: parsed.body, modelVersion: MODEL };
}
