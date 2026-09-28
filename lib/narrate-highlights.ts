// Turns the grounded facts from significance-checks.ts into a short,
// natural "what stood out" blurb. This step never decides WHAT is
// notable — that's the checks' job, and every fact it's given is already
// real. Its only jobs are: pick the best 2-3 if there are more, and write
// them up the way a knowledgeable friend would text it to you.

import Anthropic from "@anthropic-ai/sdk";
import { TARGET_TEAM_ABBREV, type SignificanceFact } from "./significance-checks";

export type HighlightResult = {
  headline: string;
  body: string;
  modelVersion: string;
};

// Sonnet, matching the recap narrator (2026-09-28): in the full
// regeneration Haiku kept inflating ("historic run" for a 14-game streak,
// "exclusive club" for a 400th goal) and kept calling Pastrnak "Pasta",
// both rejected every time. Rare facts only, so this runs on a fraction of
// ~90 Boston games a season — the cost difference is negligible.
const MODEL = process.env.HIGHLIGHTS_MODEL ?? "claude-sonnet-5";

// Well-known nicknames mapped back to the surname they stand for. Only
// applied when that surname is actually in the facts, so this can never
// introduce a player — it just undoes a formatting habit the prompt rule
// against nicknames couldn't stop (the same deterministic-backstop pattern
// as the Q&A engine's markdown stripping).
const NICKNAMES: Record<string, string> = { Pasta: "Pastrnak", Marchy: "Marchand", Bergy: "Bergeron", Z: "Chara", Sway: "Swayman" };
export function replaceNicknames(text: string, groundingText: string): string {
  return text.replace(/\b([A-Z][a-z]*)('s)?\b/g, (whole, word: string, poss: string | undefined) => {
    const surname = NICKNAMES[word];
    return surname && groundingText.includes(surname) ? surname + (poss ?? "") : whole;
  });
}

// Used only to tell a legitimate team reference ("Boston's win," "the
// Canucks") apart from a fabricated player name — not an allowlist of every
// possible team the site will ever cover, just the words that could show up
// in a possessive next to a team's own name. A couple of common nicknames
// ("Habs," "Caps") are included because real generated headlines already
// used them tonight.
export const TEAM_WORDS: Record<string, string[]> = {
  ANA: ["anaheim", "ducks"], ARI: ["arizona", "coyotes"], ATL: ["atlanta", "thrashers"],
  BOS: ["boston", "bruins"], BUF: ["buffalo", "sabres"], CAR: ["carolina", "hurricanes", "canes"],
  CBJ: ["columbus", "blue", "jackets"], CGY: ["calgary", "flames"], CHI: ["chicago", "blackhawks", "hawks"],
  COL: ["colorado", "avalanche", "avs"], DAL: ["dallas", "stars"], DET: ["detroit", "red", "wings"],
  EDM: ["edmonton", "oilers"], FLA: ["florida", "panthers", "cats"], LAK: ["los", "angeles", "kings"],
  MIN: ["minnesota", "wild"], MTL: ["montreal", "montréal", "canadiens", "habs"],
  NJD: ["new", "jersey", "devils"], NSH: ["nashville", "predators", "preds"], NYI: ["new", "york", "islanders", "isles"],
  NYR: ["new", "york", "rangers"], OTT: ["ottawa", "senators", "sens"], PHI: ["philadelphia", "flyers", "philly"],
  PHX: ["phoenix", "coyotes"], PIT: ["pittsburgh", "penguins", "pens"], SEA: ["seattle", "kraken"],
  SJS: ["san", "jose", "sharks"], STL: ["st", "louis", "blues"], TBL: ["tampa", "bay", "lightning", "bolts"],
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
// Game-flow claims no narrator can support: no play-by-play is loaded, so
// nothing knows when goals came, who scored first, which goal won it, or
// whether anyone blew a lead. Shared by both narrators (a highlight wrote
// that the Bruins "couldn't quite hold on" in a game it knew only the
// final score of).
export const FLOW_CLAIMS: RegExp[] = [
  /\b(first|second|third|1st|2nd|3rd) period\b/, /\bgame[- ]winn\w*\b/,
  /\b(comeback|rall(y|ied)|came back|come back)\b/, /\b(opened the scoring|scored first|opening goal)\b/,
  /\bempty[- ]net\b/, /\blate (goal|in the)\b/, /\b(blew (a|the|their|its) lead|blown lead|couldn.?t (quite )?hold (on|the lead)|let (it|one) slip)\b/,
  /\b(start to finish|wire[- ]to[- ]wire|from (the )?puck drop|from the opening (faceoff|shift))\b/,
];

const GENERIC_ALLOWED_WORDS = [
  "tonight", "today", "that", "this", "these", "those", "it", "he", "she", "they", "both", "there",
  // Added with the fact-sheet recaps (2026-09-28): "Nothing went right..."
  // and similar sentence openers were read as names.
  "nothing", "everything", "none", "neither", "each", "one", "someone", "everyone", "all", "what", "which",
  // Common hockey nouns that start sentences ("Season's over", "Line
  // chemistry had...", "Milestone night...") — full-regeneration false
  // positives, 2026-09-28.
  "season", "line", "lines", "milestone", "game", "night", "team", "goal", "goals", "shot", "shots", "power", "period",
  "overtime", "win", "loss", "road", "home", "series", "playoff", "playoffs", "offense", "defense", "depth", "net",
  "scoreboard", "crowd", "bench", "another", "still", "just", "even", "only", "next", "sunday", "monday", "tuesday",
  "wednesday", "thursday", "friday", "saturday",
];

// A capitalized word acting as a name (possessive, or the subject of a
// hockey-action verb) that appears nowhere in the grounding text or team
// names — the invented-player failure. Shared by both narrators. Returns
// the first offending word, or null.
export function findUngroundedName(text: string, groundingText: string, homeAbbrev: string, awayAbbrev: string): string | null {
  const groundingLower = groundingText.toLowerCase();
  const allowedTeamWords = [
    ...(TEAM_WORDS[homeAbbrev] ?? []),
    ...(TEAM_WORDS[awayAbbrev] ?? []),
    homeAbbrev.toLowerCase(),
    awayAbbrev.toLowerCase(),
  ];
  const ACTION_VERBS =
    "shut|scored?|recorded?|extended?|hits?|notched?|lit|went|had|posted?|snapped|couldn.t|picked|reached|earned|tied|broke|delivered|chipped|stayed|kept|joined|goes|keeps|didn.t|wasn.t|isn.t|made|stopped|turned|added|potted|buried";
  const namePattern = new RegExp(`\\b([A-Z][a-zA-Z]+)(?:'s\\b|\\s+(?:${ACTION_VERBS})\\b)`, "g");
  for (const m of text.matchAll(namePattern)) {
    const lower = m[1].toLowerCase();
    if (groundingLower.includes(lower) || allowedTeamWords.includes(lower) || GENERIC_ALLOWED_WORDS.includes(lower)) continue;
    return m[1];
  }
  return null;
}

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
- A fact's own words are the whole claim about how notable it is. Don't inflate it: never "exclusive club", "historic", "legendary", "unprecedented", or "all-time", and only call something rare or a first if the fact itself says so (e.g. "the first time ... since 2007-08").
- Keep it to 2-4 sentences total.
- Submit with the submit_blurb tool. Headline is under 10 words. Body is the actual blurb.`;

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

Write the blurb now and submit it with the submit_blurb tool.`;

  // A forced tool call instead of "reply with JSON": its input is always
  // structured, so no fence-stripping or parse failures.
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 900,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: "submit_blurb",
        description: "Submit the finished blurb.",
        input_schema: {
          type: "object",
          properties: {
            headline: { type: "string", description: "Under 10 words." },
            body: { type: "string", description: "2-4 sentences." },
          },
          required: ["headline", "body"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "submit_blurb" },
    messages: [{ role: "user", content: userPrompt }],
  });

  const call = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const input = (call?.input ?? {}) as { headline?: string; body?: string };
  if (!input.headline || !input.body) {
    throw new Error(`Model response missing headline or body (stop_reason ${response.stop_reason})`);
  }
  const grounding = facts.map((f) => f.fact).join(" ");
  const parsed = { headline: replaceNicknames(input.headline, grounding), body: replaceNicknames(input.body, grounding) };

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
  const combinedText = `${parsed.headline} ${parsed.body}`;
  // Significance inflation, found in regenerated highlights (2026-09-28):
  // a 200th career point became "a pretty exclusive club". The fact states
  // exactly how notable something is; these words claim more than any
  // fact here ever does.
  const flow = FLOW_CLAIMS.find((re) => re.test(combinedText.toLowerCase()));
  if (flow) throw new Error(`Narration describes game flow the facts don't contain (matched ${flow}): ${combinedText.slice(0, 200)}`);
  const hype = /\b(exclusive club|historic|legendary|unprecedented|all-time)\b/i.exec(combinedText);
  if (hype) throw new Error(`Narration inflates significance ("${hype[0]}") beyond what the facts state: ${combinedText.slice(0, 200)}`);
  const ungrounded = findUngroundedName(combinedText, facts.map((f) => f.fact).join(" "), gameContext.homeAbbrev, gameContext.awayAbbrev);
  if (ungrounded) throw new Error(`Narration mentions "${ungrounded}" who is not named in the facts, the teams, or the allowed word list.`);

  // Fifth hallucination pattern: every player named in `facts` is
  // guaranteed to be on TARGET_TEAM_ABBREV for this game (that's what
  // significance-checks.ts scopes its candidates to) — but a model that
  // also knows a player's real-world history can still mislabel him as
  // playing for whichever team he used to be on, especially when that old
  // team happens to be tonight's opponent. Found live: a Morgan Geekie
  // (Bruins) streak-snapped blurb for a CAR @ BOS game called him "the
  // Hurricanes forward" — Carolina is where he played years before Boston,
  // and the opponent that night, so both cues pointed the model the wrong
  // way at once. No fact here is ever about an opposing player, so there's
  // no legitimate reason for "the <opponent nickname> <position>" to appear.
  const opponentAbbrev = gameContext.homeAbbrev === TARGET_TEAM_ABBREV ? gameContext.awayAbbrev : gameContext.homeAbbrev;
  const opponentWords = TEAM_WORDS[opponentAbbrev] ?? [];
  if (opponentWords.length > 0) {
    const positionWords = "forwards?|defensemen|defenseman|d-man|d-men|wingers?|wing|centers?|centres?|goalies|goaltenders?|blueliners?";
    const misattribution = new RegExp(`\\b(?:the\\s+)?(?:${opponentWords.join("|")})['’]?\\s+(?:${positionWords})\\b`, "i");
    const hit = misattribution.exec(combinedText);
    if (hit) {
      throw new Error(`Narration attributes a named player to the opponent's team ("${hit[0]}") — every fact here is about a ${TARGET_TEAM_ABBREV} player: ${combinedText.slice(0, 200)}`);
    }
  }

  return { headline: parsed.headline, body: parsed.body, modelVersion: MODEL };
}
