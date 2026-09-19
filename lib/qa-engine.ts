// The historical Q&A engine: takes a natural-language question, lets Claude
// write and run its own read-only SQL against the real database, and
// answers grounded in whatever the query actually returned — never from
// the model's own training knowledge. This is the signature feature: see
// the sports-apps-vision skill for the full design rationale.
//
// Safety is layered, not single-point: the DB connection itself is the
// qa_readonly role (cannot write, enforced by Postgres — verified directly,
// not assumed), and this module adds application-level checks on top
// (single SELECT/WITH statement only, row cap, query timeout) as defense
// in depth, the same principle used throughout tonight's other fixes.

import Anthropic from "@anthropic-ai/sdk";
import { readonlyPool } from "./db";

const MODEL = "claude-sonnet-5"; // correctness on the schema-reasoning step matters more here than the narration step's cost — worth the larger model
// Raised twice now (6 -> 8 -> 10): a previously-100%-reliable question
// (goalie save% leader) hit this ceiling on a 1-of-2 retry after the
// prompt had grown further, and a genuinely complex enumeration question
// (jersey numbers ever worn) hit it too. Hitting this limit is a total
// answer failure, not a degraded one, so a bit of margin is worth it —
// but if this keeps recurring as the prompt keeps growing, the real fix
// is a leaner prompt or smarter query planning, not an ever-larger ceiling.
const MAX_TOOL_STEPS = 10;
const MAX_ROWS_RETURNED = 200;
const QUERY_TIMEOUT_MS = 8000;

const SCHEMA_DESCRIPTION = `
Tables (NHL history 2007-08 through 2025-26; every id is the NHL's own id. This started as a Bruins-only database and is actively being expanded team by team — never assume it's still Bruins-centric, verify actual coverage per team as described in "Known gaps" below):

teams(id, franchise_id, name, abbrev, city, conference, division, is_active)
team_identities(team_id, name, abbrev, start_date, end_date) -- a team's name/abbrev AS ACTUALLY USED at a point in time; teams.name/abbrev is only the current identity
players(id, full_name, position, shoots_catches, birth_date, birth_country, height_cm, weight_kg)
  -- position is a single letter: C, L, R, D, G (not "LW"/"RW"). birth_date may be NULL for players who joined mid-season after a roster snapshot.
seasons(id, start_date, end_date) -- id format e.g. '20242025'
player_team_seasons(player_id, team_id, season_id, jersey_number)
playoff_series(id, season_id, round, team_a_id, team_b_id, winner_team_id, games_played)
games(id, season_id, game_date, game_datetime, game_type, game_end_type, series_id, series_game_number, home_team_id, away_team_id, home_score, away_score, venue)
  -- game_type: 'regular' | 'playoff' | 'preseason'. game_end_type: 'regulation' | 'overtime' | 'shootout'.
skater_game_stats(game_id, player_id, team_id, goals, assists, points, shots, hits, blocked_shots, giveaways, takeaways, faceoff_wins, faceoff_losses, penalty_minutes, plus_minus, pp_goals, sh_goals, gw_goals, toi_seconds)
  -- points is goals+assists, already computed. A row only exists for games a player actually played.
  -- faceoff_wins, faceoff_losses, sh_goals, and gw_goals are ALWAYS NULL — the NHL boxscore data this is backfilled from has no per-player faceoff win/loss counts (only a percentage, not usable here) and no way to identify which specific goal was a shorthanded or game-winning goal (that needs play-by-play event data, which is separate and not yet loaded — see below). Never guess these from other columns; say the data isn't available.
goalie_game_stats(game_id, player_id, team_id, decision, shots_against, saves, goals_against, save_pct, toi_seconds, shutout)
  -- decision: 'W' | 'L' | 'OTL' | null (null = relief appearance, no decision awarded)
team_game_stats(game_id, team_id, shots_on_goal, xg_for, xg_against, corsi_for, corsi_against, pp_goals, pp_opportunities, pk_goals_against, pk_times_shorthanded, hits, faceoff_win_pct)
  -- EMPTY — zero rows loaded, not just the xg/Corsi columns. Nothing in this table is usable yet (no shots_on_goal, no pp_opportunities, no faceoff_win_pct). Never query it expecting data; treat any question needing team-level per-game stats (power play/penalty kill rate, faceoff%, team shot totals, xG, Corsi) as unanswerable and say so.
play_by_play(id, game_id, period, period_time_seconds, event_type, team_id, primary_player_id, secondary_player_id, description, x_coord, y_coord)
  -- NOT YET BACKFILLED — this table is empty. Never rely on it.
standings_snapshots(id, team_id, season_id, snapshot_date, division, conference, games_played, wins, losses, ot_losses, points, points_pct, goals_for, goals_against, division_rank, conference_rank, league_rank)
  -- division/conference here are AS OF that snapshot date, not looked up from teams (divisions have been realigned over NHL history).
  -- points_pct = points / (games_played * 2) — use this, not raw points, whenever comparing standings across different-length seasons or eras.
narratives(game_id, kind, headline, body, facts_json, source, model_version, generated_at) -- kind is 'recap' or 'highlights'; pre-generated AI content about a specific game, if any exists.
retired_numbers(id, team_id, player_id, jersey_number, retired_date)
awards(id, season_id, award_name, player_id, team_id)
cap_records(id, team_id, player_id, season_id, cap_hit, contract_years_remaining, expiry_status)

Known gaps, be honest about them rather than silently ignore:
- play_by_play is empty. Any question needing play-by-play detail (exact goal timing beyond what's in games, shot locations, period-by-period score) cannot be answered yet — say so.
- team_game_stats is entirely empty (zero rows) — not just xG/Corsi, nothing in it is loaded (power play/penalty kill rates, faceoff%, team shot totals included). Say so rather than guessing or computing from other tables as a workaround.
- Coverage varies by team and is actively being expanded — never assume a team only has "games against Boston" loaded. Check directly: count that team's total games (\`select count(*) from games where home_team_id = X or away_team_id = X\`) across its season range. A team with roughly a full season's worth of games per year (~80+) has its own complete schedule loaded; a team with only a handful of games per season has only faced Boston. Base any completeness claim in your answer on that check, never on an assumption — this changes over time as more teams get backfilled.
`.trim();

const SYSTEM_PROMPT = `You answer natural-language questions about NHL history using a real Postgres database, by writing and running your own SQL SELECT queries with the run_sql tool.

Rules, no exceptions:
- Ground every claim in what your queries actually return. Never state a stat, name, date, or record from your own training knowledge — if you didn't get it from a query result in this conversation, don't say it. This applies with full force when a row in your results has an id but no resolved name (a query that returned player_id without joining to players, for example): never fill in a plausible-sounding name from your own memory of who that Bruins-era player probably was — that is exactly the training-knowledge violation this rule forbids, and it produces a confident, wrong player identity, not just a missing name. If you don't have the real name a query actually returned, either run one more query to get it, or state plainly that this row's identity isn't resolved yet — never guess a name to fill the gap.
- Run as many queries as you need (look up a player's id first, then query their stats; check row counts before assuming completeness) — but keep it efficient, not exploratory for its own sake.
- If a question spans different eras or season lengths, prefer rate stats (points_pct, per-game averages) over raw totals, and name the relevant rule/schedule-length shift when it matters (e.g. the 2012-13 lockout-shortened season, the shift from 70-game to 82-game seasons, the introduction of the shootout in 2005-06). Never silently compare incompatible raw numbers across eras.
- If the data needed to answer doesn't exist yet (see the known gaps below) or is incomplete for the question asked, say so plainly instead of guessing or answering a different, easier question.
- If a question hinges on a genuinely undefined basis — a subjective superlative with no stated metric ("best," "most exciting," "most clutch"), or a comparison with no stated criterion — don't silently pick one metric and answer as if it were the only reasonable reading. Ask a short, specific clarifying question instead, and suggest 1-2 concrete metrics the database could actually answer with (e.g. "By 'best season' do you mean most points, or the best plus-minus? I can pull either."). Do this before running exploratory queries, not after — if the question is undefined, no amount of querying fixes that. This is different from a question with a clear single meaning that merely has more than one matching row (e.g. two players with the same surname): that's not ambiguous, just multi-valued — answer it by returning every match with enough detail to tell them apart, the way you already do, rather than asking which one they meant.
- If a query returns zero rows, that's a real answer ("this never happened in the loaded data") — don't reinterpret it as a query mistake unless you have a specific reason to think the query itself was wrong.
- Write like a knowledgeable analyst answering a fan's question: direct, specific, cites the actual numbers found. No hedging filler ("It's worth noting that..."), no hype language. Never narrate your own process or rule-following out loud ("team_id filtered out of the description," "per the formatting rules") — just write the answer a fan actually wants to read.
- A light Boston-fan perspective and a touch of dry wit are welcome — this doesn't have to read like a stats terminal. But keep it genuinely subtle here, more restrained than a typical game recap: this page's whole value proposition is that the numbers are exactly right, so voice is a light seasoning, never at the expense of precision. Skip it entirely on a purely neutral factual lookup (a single number, a date). Voice is ONLY an adjective or a short reaction bolted directly onto a number you already have in front of you ("43 goals is a serious rookie season," "a .921 save percentage is elite") — it is never a narrative claim, a nickname, or a reference to how a season or event is remembered. Do not write about what a team or season is famous for, was called, or is remembered for, and do not reach for a stock sports-writing trope (a scrappy underdog story, a Cinderella run, a team that "shocked" or "stunned" anyone, a nickname in quotes) even when it is true and well-known — found live, twice, despite a first attempt at this exact rule: an aside calling the 2017-18 Golden Knights "the Golden Misfits" who "shocked the league" with a "Cinderella run" is real hockey history, but none of it came from a query in this conversation, which the very first rule in this list forbids. True-but-ungrounded is still ungrounded. If you catch yourself writing a sentence that isn't anchored to a specific number from a result set, cut it.
- Plain prose only — this is rendered as flowing text, not Markdown. Never use **bold**, bullet lists, headers, or a Markdown pipe table ("| Date | Score |" with a "|---|---|" separator row), even when listing something naturally tabular like a list of games — write it as connected sentences instead (e.g. "Player A has X, Player B has Y, and Player C has Z" rather than a dashed list, and "Boston beat Chicago 4-3 on October 9, then beat Buffalo 4-3 on October 30" rather than a table with Date/Matchup/Score columns). The structured table result already carries the full row-by-row data separately — the prose's job is to narrate and highlight, not to re-render the same rows a second time in table form.
- The prose answer must state the actual finding on its own — the headline number, name, and date/season directly in the text — never just gesture at a supporting table ("see the table below") without saying what it shows. A table is supplementary, not a substitute for answering in words.
- Never surface a raw internal id in the answer text — this means ANY id-like column, not just team/player ids: a game id, series id, franchise id, or any other database key is just as meaningless to a reader, and this applies even when the value happens to be a small number (e.g. writing "team_id 6" for the Bruins is exactly as wrong as writing a 7-digit player id — never write a column name like "team_id" or "franchise_id" verbatim in prose at all, small value or large). This applies even when you're explaining a data-modeling detail (e.g. how a relocated franchise is tracked across multiple team rows) — explain the concept in plain language, never by citing the actual id value as if it were supporting evidence. Refer to a specific game by its actual date and opponent instead of its id, and refer to a team by its name, which you already have from the teams table — never by its id. If two players share an identical stored name (e.g. two "J. Anderson" rows), tell them apart in prose using another field your query already returned instead — games played, position, seasons active — never by quoting a database id.
- Before writing any number, name, or date into your final answer, look back at the actual tool result it came from and copy it exactly — don't reconstruct it from memory of having "just seen it." This matters most for numbers that look similar to each other in the same row (e.g. a games-played count next to a similarly-sized points total): re-read the specific field, don't guess which digit went with which column.
- Dates: a query result like "2018-03-13T04:00:00.000Z" means the date is March 13, 2018 — full stop. Never do timezone arithmetic on it, never subtract or add a day, never mention "UTC" or write anything like "(listed as X UTC)" or "actually Y in local time." There is no conversion to perform — copy the year-month-day digits directly. This has produced real wrong answers before (a date reported a full day off from what the query actually returned); when in doubt, the year-month-day characters in the raw value ARE the answer, with no arithmetic between you and it.
- Some players in this database only have an abbreviated name on file (e.g. "B. Marchand" instead of "Brad Marchand") because a full bio was never loaded for them — this is real, intentional data, not a mistake to silently correct. Never expand or "fix" an abbreviated name using a full name you recognize from your own knowledge — state it exactly as stored, character for character, no matter how obvious the real identity seems. (Not every same-surname player is abbreviated — some genuinely do have a full name on file, like a separate "Craig Anderson" row alongside abbreviated "J./M. Anderson" rows. Check what a specific row actually has stored rather than assuming from a pattern in nearby rows.)
- Never describe a number using a narrower or different scope than what the query that produced it actually filtered for. If your prose says "in games against the Bruins" or "this season" or any other named scope, the query's WHERE clause must have actually filtered for exactly that — don't take a broader result (e.g. a player's entire career total, queried with no opponent filter at all) and relabel it with a narrower description just because it's the number you have on hand. If you're unsure whether a number is scoped the way you're about to describe it, re-read the query that produced it before writing the sentence, or run the correctly-scoped query instead.
- When writing a query whose results might become the shown table, actively think about what a fan needs to understand each row on its own — not just the literal minimum the question asked for. A bare stat next to nothing meaningful is an incomplete answer. Concretely, this means replacing an opaque id with its meaningful equivalent, never leaving one in as an output column: a player's or team's real name instead of their id, a game's date and opponent instead of its id, a readable season label instead of raw season_id (use ids only internally in WHERE/JOIN conditions). It does NOT mean padding the query with extra unrelated columns or joins "just in case" — stay tight to what actually helps a reader understand this specific answer, not everything you could join in. An id you'd have to filter out of your final answer shouldn't have been selected as a display column in the first place; that's the fix, not adding more.
- For a "list every X for each Y" style question (e.g. every player who's worn each jersey number, every opponent a team has faced) — the correct SQL shape is one row per Y with the X values aggregated into a single column (Postgres string_agg, ordered, comma-or-semicolon-joined), not a flat row per (X, Y) pair. A flat table with one row per player-per-number is technically correct but far less useful than one row per number listing its players, and trying to write out every value in prose instead will run past a reasonable answer length and get cut off mid-sentence. For this shape of question: build the aggregated one-row-per-group query, and in prose give a short summary (how many distinct groups, a few interesting highlights) rather than attempting to enumerate every row — the table is where the full list belongs.
- When a question is about one specific, already-identified subject (a single named player or team) broken down across multiple rows — one row per season, per game, per opponent — the query must still select that subject's name as its own column, even though it's the same value in every row and even though the prose already states it. Found live: a "player's stat line across recent seasons" query grouped only by season_id with no name column at all, so the table read as a bare list of season numbers with no indication whose stats they were — correct in isolation, but meaningless without the surrounding prose, which defeats the point of a table that's supposed to stand on its own. The fix is in the query itself (join back to players/teams and select the name), not a note in the prose.

${SCHEMA_DESCRIPTION}`;

// A deterministic backstop, not just a prompt instruction: the model has
// reverted to Markdown formatting (bold, bullet lists, and now — found by
// the pre-season stress battery, 2026-09-19 — a literal pipe table for a
// "list every overtime game" question) four separate times in testing
// despite an explicit, increasingly detailed prohibition each time — a
// probabilistic instruction alone clearly can't guarantee this. Same
// "defense in depth" pattern as the SQL safety layer (an app-level check
// backed by a genuinely read-only DB role, not just the check alone) —
// strip artifacts here so the UI never shows a raw "**", "- ", or "|"
// table regardless of what the model actually outputs.
function stripMarkdownArtifacts(text: string): string {
  const withoutInline = text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^#{1,6}\s+/gm, "");
  return stripPipeTables(withoutInline);
}

// Handles a Markdown pipe table even when it's run together on one line
// with no newlines (the real observed shape: "...the full list: | Date |
// Matchup | Score | |---|---|---| | Oct 12, 2024 | Kings @ Bruins | BOS
// 2-1 | | Oct 19..."), which a line-anchored regex can't detect at all.
// "|" has no legitimate use in normal hockey prose, so any run of 2+
// pipe-delimited segments is table syntax — split it on "|", drop empty
// cells and pure dash/colon separator-row cells, and join what's left as
// a plain comma list. Not true narrated prose (a mechanical transform
// can't turn tabular data into real sentences), but it removes the
// visibly broken "|" characters and keeps every value, which is what a
// rare-case backstop needs to guarantee — normal prose with no table in
// it is untouched, verified directly before trusting this.
function stripPipeTables(text: string): string {
  return text.replace(/(?:\|[^|\n]*){2,}\|?/g, (match) => {
    const cells = match.split("|").map((c) => c.trim()).filter((c) => c.length > 0 && !/^[-:\s]+$/.test(c));
    return cells.join(", ");
  });
}

// Same "defense in depth" reasoning as stripMarkdownArtifacts, for a
// different rule that just failed the same way: found live (2026-09-19) —
// "still tracked in the data as franchise id 27, 'Phoenix Coyotes'" leaked
// a raw id despite an explicit, broad prompt rule against it ("ANY
// id-like column... or any other database key"). The prompt was already
// broad in principle; the gap was that nothing actually enforced it on
// the live answer path — only a test-suite regex checked for this, and
// only a narrow team/player/game/series word list at that, which
// "franchise" wasn't part of. Generalized to any `<word> id <number>`
// shape and applied to every answer, not just tested for. Removing the
// whole "<word> id <number>," clause (rather than just the number) keeps
// the surrounding sentence grammatical in the common "mentioned as an
// aside before the real name" shape this leak actually took.
function stripIdLeaks(text: string): string {
  return text.replace(/\b\w+[\s_]id\b[\s:]*\d+,?\s*/gi, "");
}

async function runReadOnlyQuery(sql: string): Promise<{ rows: unknown[] } | { error: string }> {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  // App-level defense in depth on top of the DB role itself being
  // read-only: reject anything that isn't a single SELECT/WITH statement,
  // and reject stacked statements (a semicolon followed by more text).
  if (!/^(select|with)\b/i.test(trimmed)) {
    return { error: "Only SELECT (or WITH ... SELECT) queries are allowed." };
  }
  if (/;/.test(trimmed)) {
    return { error: "Only a single statement is allowed — remove the semicolon and any text after it." };
  }

  const client = await readonlyPool.connect();
  try {
    await client.query(`set statement_timeout = ${QUERY_TIMEOUT_MS}`);
    const result = await client.query(trimmed);
    const rows = result.rows.slice(0, MAX_ROWS_RETURNED);
    return { rows };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    client.release();
  }
}

// A deterministic backstop for the table specifically, not the prose: if
// the model's own query left a bare player_id/team_id with no resolved
// name (rather than joining for one, as the prompt asks), the app itself
// looks the real name up here — code, not the LLM — so the "show your
// work" table stays name-complete no matter what the query actually
// selected. Built after finding the model invent a wrong name ("Torey
// Krug" for a player who is actually Brad Marchand) in prose when a table
// row only had an id it never resolved — this guarantees the table (which
// has been reliable in every case checked so far) never has the same gap
// that let that happen, even though it can't retroactively fix prose.
async function enrichTableWithIdNames(table: { columns: string[]; rows: Record<string, unknown>[] }): Promise<void> {
  const idColumn = table.columns.find((c) => /^player_id$/i.test(c));
  const teamIdColumn = table.columns.find((c) => /^team_id$/i.test(c));

  if (idColumn && !table.columns.some((c) => /full_name/i.test(c))) {
    const ids = [...new Set(table.rows.map((r) => r[idColumn]).filter((v) => v != null))];
    if (ids.length > 0) {
      const { rows } = await readonlyPool.query("select id, full_name from players where id = any($1)", [ids]);
      const nameById = new Map(rows.map((r) => [r.id, r.full_name as string]));
      table.columns.push("full_name");
      for (const row of table.rows) row.full_name = nameById.get(row[idColumn]) ?? null;
    }
  }

  if (teamIdColumn && !table.columns.some((c) => /^team_name$|^(?!.*full_name).*\bname\b/i.test(c))) {
    const ids = [...new Set(table.rows.map((r) => r[teamIdColumn]).filter((v) => v != null))];
    if (ids.length > 0) {
      const { rows } = await readonlyPool.query("select id, name from teams where id = any($1)", [ids]);
      const nameById = new Map(rows.map((r) => [r.id, r.name as string]));
      table.columns.push("team_name");
      for (const row of table.rows) row.team_name = nameById.get(row[teamIdColumn]) ?? null;
    }
  }
}

export type QueryRecord = { sql: string; rows: Record<string, unknown>[] | null; error?: string };

// A step-limit failure used to lose the very thing needed to diagnose it —
// the queries actually attempted during those steps were local to the
// throwing function and vanished with the exception, so qa_log recorded an
// error with an empty queries array. Carrying them on the error itself
// means a future step-limit failure is diagnosable straight from the log.
export class QAStepLimitError extends Error {
  constructor(public readonly queries: QueryRecord[], stepLimit: number) {
    super(`Exceeded ${stepLimit} tool-use steps without a final answer.`);
    this.name = "QAStepLimitError";
  }
}

export type QAResult = {
  answer: string;
  queries: QueryRecord[];
  // The best candidate for a supporting data table, if any — the last
  // query that actually returned more than one row worth showing. A
  // single-value result (a count, a yes/no) doesn't need a table; the
  // prose already carries it. Null when nothing qualifies.
  table: { columns: string[]; rows: Record<string, unknown>[] } | null;
};

export async function answerQuestion(question: string): Promise<QAResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const queries: QueryRecord[] = [];

  const tools: Anthropic.Tool[] = [
    {
      name: "run_sql",
      description: "Run a single read-only SQL SELECT query and get the results as JSON rows.",
      input_schema: {
        type: "object",
        properties: { sql: { type: "string", description: "A single SELECT (or WITH ... SELECT) statement." } },
        required: ["sql"],
      },
    },
  ];

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];

  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    const response = await client.messages.create({
      model: MODEL,
      // Real bug found live by the pre-season stress battery (2026-09-19):
      // a genuinely hard multi-team, multi-year comparison question failed
      // with a completely EMPTY final answer on 2 of 4 runs — despite
      // running real queries and building a real table. Root cause,
      // confirmed via response.stop_reason: this model produces its own
      // internal reasoning as a "thinking" content block automatically,
      // with no explicit thinking budget configured here, so it competes
      // with the final answer for the same token pool. On a hard question
      // the thinking alone can consume the whole 1500-token budget before
      // a single character of the actual answer gets written — the
      // response comes back as stop_reason "max_tokens" with ONLY a
      // thinking block, no text block at all. Raised generously (a
      // successful run on this same question needed ~2000 characters of
      // answer text alongside its own thinking) rather than tuned to a
      // minimum that could just as easily get outrun by the next hard
      // question.
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) {
      const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
      if (process.env.QA_DEBUG) {
        console.error("DEBUG stop_reason:", response.stop_reason, "content types:", response.content.map((b) => b.type), "text len:", text.length);
      }
      // Defense in depth alongside the max_tokens raise above: if this
      // ever recurs (an even harder question outrunning even a generous
      // budget), fail loudly instead of silently returning an empty
      // "successful" answer that would render as a blank box — the API
      // route already has a clear "something went wrong, try rephrasing"
      // path for a thrown error, which is a far better outcome than a
      // blank response with no error attached.
      if (text.trim().length === 0) {
        throw new Error(`Model returned no answer text (stop_reason: ${response.stop_reason}) after ${queries.length} quer${queries.length === 1 ? "y" : "ies"}.`);
      }
      // Best supporting table: among queries that returned more than one
      // row, the one with the highest rows × columns — not simply the most
      // rows. A single-row/single-value result doesn't need a table at all;
      // the prose already carries it.
      //
      // Row count alone is a bad primary signal, found live (2026-09-19)
      // even after an earlier fix that only tie-broke on column count when
      // row counts were EQUAL: a throwaway `select distinct season_id ...`
      // (1 column, 5 rows) beat the real 11-column stat-line query (4
      // rows) purely because 5 > 4 — the tie-break never even triggered,
      // since the row counts genuinely differed. A shallow lookup can
      // always out-row a substantive result this way. rows × columns
      // fixes this directly: 5×1=5 vs 4×11=44, the real table wins. Ties
      // on the product fall back to column count, then recency (a later
      // query in a refinement sequence is usually the fixed-up version of
      // an earlier one).
      const candidates = queries.filter((q) => q.rows && q.rows.length > 1);
      const tableSource = candidates.reduce<QueryRecord | null>((best, q) => {
        if (!best) return q;
        const qRows = q.rows?.length ?? 0;
        const bestRows = best.rows?.length ?? 0;
        const qCols = q.rows?.[0] ? Object.keys(q.rows[0]).length : 0;
        const bestCols = best.rows?.[0] ? Object.keys(best.rows[0]).length : 0;
        const qScore = qRows * qCols;
        const bestScore = bestRows * bestCols;
        if (qScore !== bestScore) return qScore > bestScore ? q : best;
        if (qCols !== bestCols) return qCols > bestCols ? q : best;
        return q; // equal on every measure: prefer the later (more refined) query
      }, null);
      const table = tableSource?.rows ? { columns: Object.keys(tableSource.rows[0]), rows: tableSource.rows } : null;
      if (table) await enrichTableWithIdNames(table);
      return { answer: stripIdLeaks(stripMarkdownArtifacts(text)), queries, table };
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const sql = (use.input as { sql?: unknown }).sql;
      // A malformed tool call (missing/non-string sql) crashed the whole
      // request here in testing — found by the regression suite itself,
      // not anticipated up front. Report it as a tool error so the model
      // can retry, instead of throwing and losing the entire answer.
      const result: { rows: unknown[] } | { error: string } =
        typeof sql === "string" && sql.length > 0
          ? await runReadOnlyQuery(sql)
          : { error: "No SQL was provided with this tool call — call run_sql again with a sql string." };
      queries.push({
        sql: typeof sql === "string" ? sql : "",
        rows: "rows" in result ? result.rows as Record<string, unknown>[] : null,
        error: "error" in result ? result.error : undefined,
      });
      toolResults.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  throw new QAStepLimitError(queries, MAX_TOOL_STEPS);
}
