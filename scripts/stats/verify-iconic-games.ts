// Checks every curated entry in config/iconic-games.ts against the loaded
// history, and stores only the ones whose claims hold: the right game
// exists, and its score, overtime, decisive scorer and comeback all match
// what the entry says. Rejections are printed for a human to fix; nothing
// is stored on faith. Rebuilds iconic_games from scratch each run.
//
// Usage: npx tsx --env-file=.env.local scripts/stats/verify-iconic-games.ts [--dry-run]

import { Client } from "pg";
import { ICONIC_GAMES, type IconicEntry } from "../../config/iconic-games";

type GameRow = { id: number; season: string; game_type: string; game_date: string; home_team_id: number; away_team_id: number; home_score: number; away_score: number; final_state: string; ot_periods: number };

async function main() {
  const dry = process.argv.includes("--dry-run");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const { rows: teams } = await client.query(`select id, tri_code from nhl_teams`);
  const idsFor = (tri: string) => teams.filter((t) => t.tri_code === tri).map((t) => Number(t.id));

  async function resolve(e: IconicEntry): Promise<GameRow | string> {
    const mine = idsFor(e.team);
    const theirs = idsFor(e.opp);
    if (!mine.length || !theirs.length) return `unknown team code ${!mine.length ? e.team : e.opp}`;
    const { rows } = await client.query<GameRow>(
      `select id, season, game_type, game_date::text, home_team_id, away_team_id, home_score, away_score, final_state, ot_periods
       from nhl_games
       where season = $1 and game_type = $2
         and ((home_team_id = any($3) and away_team_id = any($4)) or (home_team_id = any($4) and away_team_id = any($3)))
         ${e.date ? "and game_date = $5" : ""}
       order by game_date, id`,
      e.date ? [e.season, "regular", mine, theirs, e.date] : [e.season, "playoff", mine, theirs],
    );
    if (e.date) return rows[0] ?? `no ${e.team}-${e.opp} game on ${e.date}`;
    return rows[(e.playoffGame ?? 0) - 1] ?? `no Game ${e.playoffGame} (${rows.length} playoff games ${e.team}-${e.opp} in ${e.season})`;
  }

  async function check(e: IconicEntry, g: GameRow): Promise<string[]> {
    const home = idsFor(e.team).includes(g.home_team_id);
    const teamScore = home ? g.home_score : g.away_score;
    const oppScore = home ? g.away_score : g.home_score;
    const x = e.expect;
    const problems: string[] = [];
    const say = (what: string, want: unknown, got: unknown) => problems.push(`${what}: expected ${want}, data says ${got}`);
    if (x.teamScore != null && x.teamScore !== teamScore) say("team score", x.teamScore, teamScore);
    if (x.oppScore != null && x.oppScore !== oppScore) say("opponent score", x.oppScore, oppScore);
    if (x.won != null && x.won !== teamScore > oppScore) say("result", x.won ? "win" : "loss", `${teamScore}-${oppScore}`);
    if (x.ot != null && x.ot !== (g.final_state === "OT")) say("overtime", x.ot, g.final_state);
    if (x.otPeriods != null && x.otPeriods !== g.ot_periods) say("overtime periods", x.otPeriods, g.ot_periods);
    if (x.shootout != null && x.shootout !== (g.final_state === "SO")) say("shootout", x.shootout, g.final_state);
    if (x.lastGoalBy || x.trailedBy || x.ledBy) {
      const { rows: goals } = await client.query(
        `select e.team_id, e.score_before_home, e.score_before_away, p.full_name
         from nhl_goal_events e left join nhl_players p on p.id = e.scorer_id
         where e.game_id = $1 order by e.period, e.time_in_period_sec, e.event_id`,
        [g.id],
      );
      if (x.lastGoalBy) {
        const last = goals.at(-1)?.full_name ?? "(none)";
        if (!last.toLowerCase().endsWith(x.lastGoalBy.toLowerCase())) say("final goal scorer", x.lastGoalBy, last);
      }
      // Margins at every point, from this team's side (after each goal).
      let maxLead = 0;
      let maxDeficit = 0;
      for (const goal of goals) {
        const h = goal.score_before_home + (goal.team_id === g.home_team_id ? 1 : 0);
        const a = goal.score_before_away + (goal.team_id === g.away_team_id ? 1 : 0);
        const margin = home ? h - a : a - h;
        maxLead = Math.max(maxLead, margin);
        maxDeficit = Math.max(maxDeficit, -margin);
      }
      if (x.trailedBy && maxDeficit < x.trailedBy) say("largest deficit", `>= ${x.trailedBy}`, maxDeficit);
      if (x.ledBy && maxLead < x.ledBy) say("largest lead", `>= ${x.ledBy}`, maxLead);
    }
    return problems;
  }

  const verified: { e: IconicEntry; g: GameRow }[] = [];
  const rejected: string[] = [];
  for (const e of ICONIC_GAMES) {
    const g = await resolve(e);
    const name = `${e.season.slice(4)} ${e.team}-${e.opp} ${e.date ?? `G${e.playoffGame}`} "${e.label}"`;
    if (typeof g === "string") {
      rejected.push(`${name}: ${g}`);
      continue;
    }
    const problems = await check(e, g);
    if (problems.length) rejected.push(`${name} (${g.id}, ${g.game_date}): ${problems.join("; ")}`);
    else verified.push({ e, g });
  }

  console.log(`${verified.length} of ${ICONIC_GAMES.length} curated games verified.`);
  if (rejected.length) console.log(`\nRejected (${rejected.length}), fix the entry or the claim:\n  ${rejected.join("\n  ")}`);

  if (!dry) {
    await client.query("begin");
    await client.query("delete from iconic_games");
    for (const { e, g } of verified) {
      await client.query(
        `insert into iconic_games (game_id, label, short_story, fame_weight, category, curated_by, verified_at) values ($1, $2, $3, $4, $5, 'site owner (approved 2026-10-01)', now())`,
        [g.id, e.label, e.story, e.weight, e.category],
      );
    }
    await client.query("commit");
    console.log(`Stored ${verified.length} verified games in iconic_games.`);
  }
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
