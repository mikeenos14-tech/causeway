import { pool } from "./db";
import { normalizeQuestion } from "./qa-cache";

// A question on the homepage with its answer already filled in, so the Ask
// box shows what it can do instead of waiting for someone to think of a
// question. On a Bruins game day it's about tonight's opponent; otherwise
// it rotates through questions picked to be answerable from the database
// (no faceoffs, game-winners, or shorthanded goals — see qa-engine's
// schema notes) and interesting to argue about.
//
// Full Bruins history since 1924 (the "since 2007-08" wording predated the
// history load); Ask says where a stat starts later (save percentage,
// plus-minus). Answered ahead of time by /api/cron/warm-qotd on Vercel
// (hourly; it calls the model about once a day), so a homepage view never
// waits on, or pays for, a model call. It used to run in the hourly GitHub
// job, which never had Ask's read-only database login and failed quietly
// every day until 2026-10-17.

export const ROTATION = [
  "Who has scored the most regular-season goals in Bruins history?",
  "Which Bruins goalie has the best regular-season save percentage, minimum 100 games?",
  "What's the longest point streak in Bruins history?",
  "Which Bruins player has the most hat tricks?",
  "What was the Bruins' best regular season by points percentage?",
  "Which team have the Bruins beaten the most times?",
  "Which team has beaten the Bruins the most times?",
  "Who has the most playoff points in Bruins history?",
  "What's the Bruins' biggest regular-season margin of victory?",
  "Which Bruins defenseman has scored the most regular-season goals?",
  "How many regular-season shutouts did Tuukka Rask record for the Bruins?",
  "Who has the most power-play goals in Bruins history?",
  "What's the Bruins' record in shootouts since they began in 2005-06?",
  "Which Bruins player has the most 4-point games?",
  "Who scored the most goals in a single season for the Bruins?",
  "What's the most points a Bruins player has scored in one game?",
  "Which opposing goalie has the most wins against the Bruins?",
  "Who has scored the most goals against the Bruins?",
  "How many times have the Bruins scored 10 or more goals in a game?",
  "Which Bruins player has the most penalty minutes?",
  "What's the Bruins' all-time playoff series record?",
  "Which season did the Bruins allow the fewest goals per game?",
  "Who has played the most regular-season games for the Bruins?",
  "Which Bruins player had the best plus-minus in a single season?",
];

const ET_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

export function etDate(at: Date): string {
  return ET_DAY.format(at); // "2026-10-01"
}

// tonight: the Bruins' game today (ET), if any — opponent's full name.
export function questionOfTheDay(at: Date, tonight: { opponentName: string } | null): string {
  if (tonight) return `What's the Bruins' all-time regular-season record against the ${tonight.opponentName}?`;
  const day = Math.floor(Date.parse(`${etDate(at)}T00:00:00Z`) / 86_400_000);
  return ROTATION[day % ROTATION.length];
}

// The cached answer, if today's warm-up has run. A day and a half of
// slack so a late warm-up never blanks the homepage.
export async function getCachedAnswer(question: string): Promise<string | null> {
  try {
    const { rows } = await pool.query(
      `select answer from qa_answer_cache
       where normalized_question = $1 and created_at > now() - interval '36 hours'
         and created_at > coalesce((select max(g.created_at) from games g join teams t on t.id in (g.home_team_id, g.away_team_id) where t.abbrev = 'BOS'), '-infinity')`,
      [normalizeQuestion(question)],
    );
    return rows[0]?.answer ?? null;
  } catch {
    return null;
  }
}

// The answer's opening, for the homepage card; the full answer, table and
// SQL are one tap away on /ask.
export function answerTeaser(answer: string, maxChars = 320): string {
  // Split only where a sentence ends and the next begins, so ".908" and
  // "2007-08" stay whole.
  const sentences = answer.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/);
  let out = "";
  for (const s of sentences) {
    if (out && (out + " " + s).length > maxChars) break;
    out = out ? `${out} ${s}` : s;
  }
  return out;
}

// True for any question this module can produce, so /api/ask can serve
// the day's warmed answer instead of paying for a fresh one per click.
export function isQuestionOfTheDay(question: string): boolean {
  const n = normalizeQuestion(question);
  return ROTATION.some((q) => normalizeQuestion(q) === n) || /^what's the bruins' regular-season record against the [a-z .'é-]+ since 2007-08$/.test(n);
}

// When the Bruins' totals last changed: the newest Bruins game we've
// loaded. A cached daily answer older than this is stale (tonight's
// result changes "since 2007-08" totals), so it's neither shown nor served.
export async function bruinsDataChangedAt(): Promise<Date | null> {
  const { rows } = await pool.query(
    `select max(g.created_at) as at from games g join teams t on t.id in (g.home_team_id, g.away_team_id) where t.abbrev = 'BOS'`,
  );
  return rows[0]?.at ?? null;
}
