// The narration path for a game significance-checks.ts found nothing rare
// about — most games. Grounded in a verified fact sheet (lib/game-facts.ts):
// result, where the game sits in the season or series, who scored, the
// goalies, and team shots/xG/power play when loaded.
//
// Why a fact sheet (2026-09-28): this path once received only the final
// score, so it had nothing true to say about a 4-goal, 6-assist night and
// filled the gap by inference — "Buffalo dominated" from a 4-1 score,
// "home opener" for a team's fourth game. Validators were already
// rejecting some of those; the fix is to give the model real material, and
// keep validating that it stays inside it.
//
// Deliberately still a separate function from narrateHighlights: that path
// narrates pre-verified RARE facts; this one describes an ordinary game and
// must not manufacture significance.

import Anthropic from "@anthropic-ai/sdk";
import { TEAM_WORDS, FLOW_CLAIMS, findUngroundedName, replaceNicknames } from "./narrate-highlights";
import type { GameFacts } from "./game-facts";

export type RecapResult = {
  headline: string;
  body: string;
  modelVersion: string;
};

// Sonnet, not Haiku: with a real fact sheet to work from, Haiku produced
// garbled lines ("leading the way at a point per goal plus two assists")
// and unsupported reads in a side-by-side trial; Sonnet's were coherent.
// ~90 Boston games a season makes the cost difference negligible.
const MODEL = process.env.RECAP_MODEL ?? "claude-sonnet-5";

const SYSTEM_PROMPT = `You write a short recap line for Causeway, a Boston Bruins fan site, about one game. You get a verified fact sheet from the database. Nothing statistically rare happened in this game (that's handled elsewhere), so this is an honest account of an ordinary game.

Rules, no exceptions:
- Use ONLY the fact sheet. Every name, number, and claim must come from it. Never add anything from your own knowledge: no nicknames, no player history, no standings or playoff-race implications, no streaks, records, or milestones.
- The sheet does NOT tell you when goals were scored, who scored first, which goal won the game, or how the game unfolded period by period. Never describe any of that: no periods, no "opened the scoring," no "game-winner," no comebacks, no "late goal," no empty-net goals.
- Only call the game a season opener, home opener, season finale, or a specific playoff game (Game 6, a clinching or elimination game) if the sheet literally says so.
- Judge the run of play only from what the sheet gives: the score, and shots on goal or expected goals if listed. If shots and expected goals point different ways from the score, that's worth saying plainly. If neither is listed, don't characterize who controlled the game at all — the score alone doesn't tell you.
- Mention the 1-3 most relevant specifics (a multi-goal scorer, a big assist night, a goalie's workload, a goalie being pulled). Name only players on the sheet, exactly as written there.
- Voice: a die-hard Bruins fan with a dry, understated sense of humor, texting a friend. Let the result set the tone (a blowout, a tight win, a deflating loss read differently). No hype: never "historic", "rare", "incredible", "amazing", "exclusive club", or similar — this path has no rarity facts. Sentence case with proper nouns capitalized as usual (player, team, and city names), no exclamation points, no Markdown.
- 2-3 sentences.
- Submit with the submit_recap tool. Headline is under 10 words.`;

// Claims that need grounding the sheet may or may not provide. Each is
// allowed only when the sheet itself contains the supporting words.
const CONDITIONAL_CLAIMS: { pattern: RegExp; allowedIf: (facts: string) => boolean; what: string }[] = [
  // "Season opener" / "home opener" need the sheet to say so; a plain
  // "opener" also fits Game 1 of a series or the first meeting of a season
  // series ("drop the opener vs the Rangers").
  { pattern: /\bseason opener\b/, allowedIf: (f) => /season opener/.test(f), what: "a season opener" },
  { pattern: /\bhome opener\b/, allowedIf: (f) => /home opener/.test(f), what: "a home opener" },
  { pattern: /\bopener\b/, allowedIf: (f) => /opener|Game 1\b|\(1 meeting so far this season\)/i.test(f), what: "an opener" },
  { pattern: /\b(finale|final (regular-season )?game|last game of the (regular )?season)\b/, allowedIf: (f) => /final regular-season game/.test(f), what: "a season finale" },
  // "Advance" only as a series result ("advance to the second round"), not
  // "advance to 30-5-3" in a regular-season recap (batch false positive).
  { pattern: /\b(clinch\w*|eliminat\w*|advance[sd]? (to|past|into) (the )?(next|second|third|conference|stanley|final|round))\b/, allowedIf: (f) => /won the series/i.test(f), what: "a series result" },

  { pattern: /\b(dominat\w*|outplay\w*|controlled|carried the play|outshot|out-?chanced|lopsided)\b/, allowedIf: (f) => /Shots on goal|Expected goals/.test(f), what: "run-of-play" },
  { pattern: /\b(overtime|OT)\b/i, allowedIf: (f) => /in overtime/.test(f), what: "overtime" },
  { pattern: /\bshootout\b/, allowedIf: (f) => /in a shootout/.test(f), what: "a shootout" },
  { pattern: /\bpower[- ]play\b/, allowedIf: (f) => /Power play:/.test(f), what: "power play" },
  { pattern: /\bshutout\b/, allowedIf: (f) => /shutout/.test(f), what: "a shutout" },
  { pattern: /\bpulled\b/, allowedIf: (f) => /changed goalies/.test(f), what: "a goalie change" },
];

// Never supportable from the sheet (no play-by-play, no rarity facts).
const UNSUPPORTED_CLAIMS: RegExp[] = [
  // "Record" alone is fine now that the sheet carries the season record
  // (its values are checked separately); record-SETTING claims are not.
  /\bstreak\b/, /\b(franchise|team|career|nhl|league|club|arena|all-time)[- ]record\b/, /\b(set|sets|setting|broke|breaks|tied|ties) (a|the|his|their) record\b/, /\brecord[- ](setting|breaking|tying)\b/,
  /\bmilestone\b/, /\bfirst time\b/, /\bsince \d{4}\b/,
  ...FLOW_CLAIMS, /\bwinner\b/, /\bfirst goal\b/, /\bshorthanded\b/,
  /\b(historic|rare|rarely|unprecedented|all-time|legendary|exclusive|incredible|amazing)\b/,
];

export async function narrateRecap(facts: GameFacts): Promise<RecapResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const userPrompt = `Fact sheet (verified from the database):
${facts.lines.map((l) => `- ${l}`).join("\n")}

Write the recap now and submit it with the submit_recap tool.`;

  // Submitted through a forced tool call rather than "reply with JSON":
  // in trials the model sometimes wrapped or followed its JSON with other
  // text ("Wait, must output only JSON..."), which no amount of fence-
  // stripping reliably handles. A tool call's input is always structured.
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 900, // 400 truncated Sonnet mid-answer on 3 of 12 trial games
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: "submit_recap",
        description: "Submit the finished recap.",
        input_schema: {
          type: "object",
          properties: {
            headline: { type: "string", description: "Under 10 words." },
            body: { type: "string", description: "2-3 sentences." },
          },
          required: ["headline", "body"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "submit_recap" },
    messages: [{ role: "user", content: userPrompt }],
  });

  const call = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const input = (call?.input ?? {}) as { headline?: string; body?: string };
  if (!input.headline || !input.body) {
    throw new Error(`Model response missing headline or body (stop_reason ${response.stop_reason})`);
  }
  const names = facts.properNames.join(" ");
  const parsed = {
    headline: replaceNicknames(fixCapitalization(input.headline, facts), names),
    body: replaceNicknames(fixCapitalization(input.body, facts), names),
  };

  validateRecap(parsed, facts);

  return { headline: parsed.headline, body: parsed.body, modelVersion: MODEL };
}

// Every rule a recap must pass before it's stored. Exported so the rules
// themselves can be tested against real good and bad text
// (scripts/test-recap-validators.ts) — a safeguard that blocks output is
// code too, and gets the same test-before-trust treatment.
export function validateRecap(parsed: { headline: string; body: string }, facts: GameFacts): void {
  const combined = `${parsed.headline} ${parsed.body}`;
  const lower = combined.toLowerCase();
  const reject = (why: string) => {
    throw new Error(`Recap ${why}: ${lower.slice(0, 200)}`);
  };

  const unsupported = UNSUPPORTED_CLAIMS.find((re) => re.test(lower));
  if (unsupported) reject(`makes a claim the fact sheet can't support (matched ${unsupported})`);
  for (const c of CONDITIONAL_CLAIMS) {
    if (c.pattern.test(combined) && !c.allowedIf(facts.text)) reject(`claims ${c.what} the fact sheet doesn't state (matched ${c.pattern})`);
  }
  // Direction check for shot/xG comparisons: right after a word of
  // superiority, the first number of the pair must be the larger one
  // ("outshot them 33-23", not "dominated expected goals 2.46 to 3.54",
  // which a trial recap wrote for the team that trailed). Natural phrasing
  // always puts the leading side's number first after these words.
  for (const m of lower.matchAll(/\b(dominat\w*|edge|advantage|favou?r(?:ed|ing)?|outshot|out-?chanced|controlled|more)\b[^.;]{0,50}?(\d+(?:\.\d+)?)\s*(?:-|to|–)\s*(\d+(?:\.\d+)?)/g)) {
    if (Number(m[2]) < Number(m[3])) reject(`states a comparison backwards ("${m[0].trim()}")`);
  }

  // Who led: the sheet states it leader-first ("CBJ outshot BOS, 35 to
  // 22"). A published trial recap inverted that — "the Bruins won the shot
  // battle, outshooting Columbus 35-22" — with every number correct, so the
  // number checks above passed it. Resolve team words in the text and
  // check the subject (who outshot / dominated) and object (who got
  // outshot) against the sheet's leaders.
  const shotsLeader = /Shots on goal: (\w+) outshot (\w+)/.exec(facts.text);
  const xgLeader = /Expected goals \(MoneyPuck\): (\w+) had more expected goals than (\w+)/.exec(facts.text);
  const teamOf = (word: string): string | null => {
    const w = word.toLowerCase().replace(/['’]s$/, "");
    for (const abbrev of [facts.homeAbbrev, facts.awayAbbrev]) {
      if (w === abbrev.toLowerCase() || (TEAM_WORDS[abbrev] ?? []).includes(w)) return abbrev;
    }
    return null;
  };
  const leaderFor = (verb: string) => (/shot|shoot/.test(verb) ? shotsLeader : (xgLeader ?? shotsLeader));
  // Subject: "<team> outshot ...", "<team> won the shot battle", "<team> dominated".
  for (const m of combined.matchAll(/\b([A-Za-z]+)(?:['’]s)?\s+(?:\w+\s+){0,2}?(outshot\w*|outshooting|won the shot battle|dominated|out-?chanced|outplayed)\b/gi)) {
    // A clause word between the team and the verb means the team isn't the
    // subject ("a win in Carolina despite getting outplayed" is about the
    // Bruins) — too ambiguous to judge, so skip rather than misfire.
    if (/\b(despite|while|after|but|and|as|though|although|in|at|on|over|from|with|against)\b/i.test(m[0].slice(m[1].length, m[0].length - m[2].length))) continue;
    const team = teamOf(m[1]);
    const lead = leaderFor(m[2].toLowerCase());
    // Passive voice ("Boston was outshot", headline-style "Bruins outplayed
    // in Nashville" / "outshot by Columbus") makes the subject the side
    // that TRAILED, so the check flips rather than being skipped.
    // Headlinese drops the auxiliary too ("Bruins outshot but outscore
    // Blues", "outshot and outchanced, win anyway"), so the verb only reads
    // as active when an object follows it: a team word, a pronoun or
    // article, or the score itself.
    const afterVerb = combined.slice(m.index! + m[0].length);
    const objectWord = /^\s+([A-Za-z]+|\d)/.exec(afterVerb)?.[1] ?? "";
    const hasObject = /^\d/.test(objectWord) || /^(the|them|their|its|his|every|opponents?)$/i.test(objectWord) || teamOf(objectWord) !== null;
    const passive = /\b(was|were|got|get|getting|being|been)\b/i.test(m[0]) || !hasObject;
    if (passive) {
      if (team && lead && team === lead[1]) reject(`says ${team} was "${m[2]}", but the sheet has ${team} leading`);
      continue;
    }
    if (team && lead && team === lead[2]) reject(`credits ${team} with "${m[2]}", but the sheet has ${lead[1]} leading`);
  }
  // Object: "outshooting <team>", "outplayed <team>".
  for (const m of combined.matchAll(/\b(outshot|outshooting|outshoots|out-?chanced|outplayed|dominated)\s+(?:the\s+)?([A-Za-z]+)/gi)) {
    const team = teamOf(m[2]);
    const lead = leaderFor(m[1].toLowerCase());
    if (team && lead && team === lead[1]) reject(`says ${lead[1]} was "${m[1]}", but the sheet has ${lead[1]} leading`);
  }

  // W-L-OTL records: every one must be a record on the sheet (the team's
  // season record, or the season series vs this opponent), and the series
  // record must not be passed off as the season record — a trial recap
  // wrote "improve to 1-0-0 on the young season" from the series line.
  // (A first version classified each record by nearby words like "against"
  // and misfired whenever one sentence carried both records.)
  const seasonRec = /season record after this game: (\d+-\d+-\d+)/.exec(facts.text)?.[1];
  const seriesRec = /Season series vs \w+ after this game[^:]*: \w+ (\d+-\d+-\d+)/.exec(facts.text)?.[1];
  const triples = [...lower.matchAll(/\b\d+-\d+-\d+\b/g)];
  triples.forEach((m, i) => {
    if (m[0] !== seasonRec && m[0] !== seriesRec) reject(`gives a record (${m[0]}) that isn't on the sheet`);
    // Each record's context stops at its neighbors, so the words framing
    // one record in "moves to 2-0-0, and 1-0-0 against Nashville" can't be
    // read as framing the other.
    const prevEnd = i > 0 ? triples[i - 1].index! + triples[i - 1][0].length : 0;
    const nextStart = i < triples.length - 1 ? triples[i + 1].index! : lower.length;
    const before = lower.slice(Math.max(prevEnd, m.index! - 30), m.index!);
    const after = lower.slice(m.index! + m[0].length, Math.min(nextStart, m.index! + m[0].length + 30));
    const framedAsSeason = /(improv|mov|fall|drop|sit|now|climb|slip)\w*\s+(to|at)\s*$|record (of|at)\s*$/.test(before) || /^\s*(on|for) the (young )?season/.test(after);
    const framedAsSeries = /\b(against|vs\.?|versus|series|head-to-head)\b/.test(after) || /(against|vs\.?|versus|series)[^.]{0,20}$/.test(before);
    if (m[0] === seriesRec && m[0] !== seasonRec && framedAsSeason && !framedAsSeries) reject(`presents the season-series record ${m[0]} as the season record (${seasonRec})`);
    if (m[0] === seasonRec && m[0] !== seriesRec && framedAsSeries && !framedAsSeason) reject(`presents the season record ${m[0]} as the season-series record (${seriesRec})`);
  });

  // "Game 6" / "game two": only the exact game number the sheet states
  // (a playoff game number, or a regular-season "game N of the season").
  const WORD_NUM: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7" };
  // (not a score: "won the opening game 4-3" is about game 1)
  for (const m of lower.matchAll(/\bgame (one|two|three|four|five|six|seven|\d+)\b(?!\s*[-–]\s*\d)/g)) {
    const n = WORD_NUM[m[1]] ?? m[1];
    // The next game of a series that isn't over follows from the sheet
    // ("force a Game 6" after Game 5, "on to Game 7" after a 3-3 Game 6).
    const current = /Game (\d) vs/.exec(facts.text)?.[1];
    const seriesOver = /won the series/.test(facts.text);
    if (current && !seriesOver && Number(n) === Number(current) + 1) continue;
    if (!new RegExp(`\\bgame ${n}\\b`, "i").test(facts.text)) reject(`claims "${m[0]}", which the fact sheet doesn't state`);
  }

  // Every number in the recap must appear on the sheet (scores, goal
  // counts, saves, shots). Small words-as-numbers ("two goals") aren't
  // checked; digits are, since that's where transcription slips show up.
  // A rounded form of a sheet decimal counts ("4.5" for 4.52 — a batch
  // recap was rejected for exactly that).
  const sheetNumbers = new Set(facts.text.match(/\d+(\.\d+)?/g) ?? []);
  const sheetDecimals = [...sheetNumbers].filter((n) => n.includes(".")).map(Number);
  const nextSeriesGame = !/won the series/.test(facts.text) ? /Game (\d) vs/.exec(facts.text)?.[1] : undefined;
  const onSheet = (n: string) => {
    if (sheetNumbers.has(n)) return true;
    // "force a Game 7" after Game 6: the next game of an undecided series.
    if (nextSeriesGame && Number(n) === Number(nextSeriesGame) + 1) return true;
    if (!n.includes(".")) return false;
    const places = n.split(".")[1].length;
    return sheetDecimals.some((d) => d.toFixed(places) === n);
  };
  const inventedNumber = (combined.match(/\d+(\.\d+)?/g) ?? []).find((n) => !onSheet(n));
  if (inventedNumber) reject(`uses a number not on the fact sheet (${inventedNumber})`);

  const ungrounded = findUngroundedName(combined, facts.text, facts.homeAbbrev, facts.awayAbbrev);
  if (ungrounded) reject(`mentions "${ungrounded}", who isn't on the fact sheet`);

  // Venue: found live before the fact sheet existed — a Boston home game
  // narrated as happening "in Buffalo". Reject "in <away city>".
  const awayCityWords = TEAM_WORDS[facts.awayAbbrev] ?? [];
  const homeCityWords = new Set(TEAM_WORDS[facts.homeAbbrev] ?? []);
  const wrongVenue = awayCityWords.find((w) => !homeCityWords.has(w) && new RegExp(`\\bin ${w}\\b`, "i").test(combined));
  if (wrongVenue) reject(`places the game "in ${wrongVenue}" (the away team's city), but ${facts.homeAbbrev} was home`);

}

// Names from the fact sheet, restored to their capitalization. Trial
// output lowercased them ("drop game 1 in buffalo", "reilly smith") despite
// the instruction — a formatting slip safe to correct in code, the same
// pattern as the Q&A engine's markdown stripping. Uses only the sheet's
// explicit proper names (teams, arena, players); an earlier version
// guessed names from capitalized word runs and turned "after" into "After".
const COMMON_WORDS = new Set(["new", "bay", "blue", "red", "golden", "st", "center", "centre", "arena", "garden", "the", "of", "and", "de", "van", "le"]);
function fixCapitalization(text: string, facts: GameFacts): string {
  const proper = new Map<string, string>();
  for (const name of facts.properNames) {
    for (const word of name.split(/\s+/)) {
      const lower = word.toLowerCase();
      if (!COMMON_WORDS.has(lower) && word.length > 2 && /^[A-Z]/.test(word)) proper.set(lower, word);
    }
  }
  return text.replace(/\b[a-z][a-zA-Z'’.-]+\b/g, (w) => proper.get(w) ?? w);
}
