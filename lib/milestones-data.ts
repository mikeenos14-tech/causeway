import { pool } from "./db";
import { hasFullCareerLoaded } from "./significance-checks";

export type Milestone = {
  playerId: number;
  playerName: string;
  category: string;
  current: number;
  target: number;
  remaining: number;
};

const GOAL_TARGETS = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
const POINT_TARGETS = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1200, 1500];
const GAME_TARGETS = [100, 200, 300, 500, 700, 1000];
const WIN_TARGETS = [50, 100, 150, 200, 250, 300, 400];
const SHUTOUT_TARGETS = [10, 20, 30, 40, 50];

// How close a player must be for a countdown to be worth showing
// (broadcasts don't say "needs 80 more goals for 500"). Per stat, sized to
// roughly a few weeks of play: a flat 15 once produced "needs 9 more
// shutouts for 10" — most of a career for a backup goalie.
const WINDOW = { goals: 5, points: 10, games: 10, wins: 5, shutouts: 2 } as const;

// Who is actually on the team right now, from the NHL's live roster —
// the same live-fetch pattern as lib/next-game.ts. Milestone Watch is a
// forward-looking claim ("needs 4 more"), so it can only name players who
// can still reach it here: the season-played filter below alone kept
// featuring players traded or released over the summer. On a failed fetch
// we return null and the module hides rather than risk naming ex-players.
async function getCurrentRosterIds(teamAbbrev: string): Promise<Set<number> | null> {
  try {
    const res = await fetch(`https://api-web.nhle.com/v1/roster/${teamAbbrev}/current`, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const data = await res.json();
    const ids = [...(data.forwards ?? []), ...(data.defensemen ?? []), ...(data.goalies ?? [])].map((p: { id: number }) => p.id);
    return ids.length > 0 ? new Set(ids) : null;
  } catch (err) {
    console.error("getCurrentRosterIds failed (non-fatal — Milestone Watch hides):", err);
    return null;
  }
}

// The nearest target this player hasn't reached yet, within the window.
function nearestUpcoming(current: number, targets: number[], maxRemaining: number): number | null {
  const next = targets.find((t) => t > current && t - current <= maxRemaining);
  return next ?? null;
}

// Career milestones for every player on the CURRENT roster — reuses the
// same hasFullCareerLoaded guard the player pages already use for "Career
// Totals" vs. "Totals Since 2007-08": a milestone countdown is only an
// honest claim if we can verify the player's whole career is actually
// loaded, not just what happens to be in this database. A player who
// debuted before 2007-08 with no birth_date on file is silently excluded
// rather than risk a wrong countdown.
//
// Regular season only, matching how the NHL counts every career milestone
// — summing playoffs too once put every countdown on the homepage off
// (Kuraly "4 points from 200" was really 25).
export async function getUpcomingMilestones(teamAbbrev: string, seasonId: string): Promise<Milestone[]> {
  const { rows: skaters } = await pool.query(
    `select p.id, p.full_name, p.birth_date,
            (select count(*) from skater_game_stats x join games xg on xg.id = x.game_id
              where x.player_id = p.id and xg.game_type = 'regular') as career_games,
            (select coalesce(sum(x.goals),0) from skater_game_stats x join games xg on xg.id = x.game_id
              where x.player_id = p.id and xg.game_type = 'regular') as career_goals,
            (select coalesce(sum(x.points),0) from skater_game_stats x join games xg on xg.id = x.game_id
              where x.player_id = p.id and xg.game_type = 'regular') as career_points
     from players p
     where p.id in (
       select distinct sgs.player_id from skater_game_stats sgs
       join games g on g.id = sgs.game_id
       join teams t on t.id = sgs.team_id
       where t.abbrev = $1 and g.season_id = $2 and g.game_type = 'regular'
     )`,
    [teamAbbrev, seasonId],
  );

  const { rows: goalies } = await pool.query(
    `select p.id, p.full_name, p.birth_date,
            (select count(*) from goalie_game_stats x join games xg on xg.id = x.game_id
              where x.player_id = p.id and xg.game_type = 'regular') as career_games,
            (select coalesce(sum(case when x.decision='W' then 1 else 0 end),0) from goalie_game_stats x join games xg on xg.id = x.game_id
              where x.player_id = p.id and xg.game_type = 'regular') as career_wins,
            (select coalesce(sum(x.shutout::int),0) from goalie_game_stats x join games xg on xg.id = x.game_id
              where x.player_id = p.id and xg.game_type = 'regular') as career_shutouts
     from players p
     where p.id in (
       select distinct ggs.player_id from goalie_game_stats ggs
       join games g on g.id = ggs.game_id
       join teams t on t.id = ggs.team_id
       where t.abbrev = $1 and g.season_id = $2 and g.game_type = 'regular'
     )`,
    [teamAbbrev, seasonId],
  );

  const roster = await getCurrentRosterIds(teamAbbrev);
  if (!roster) return [];

  const milestones: Milestone[] = [];

  for (const s of skaters) {
    if (!roster.has(Number(s.id))) continue;
    if (!hasFullCareerLoaded(s.birth_date)) continue;
    const goals = Number(s.career_goals);
    const points = Number(s.career_points);
    const games = Number(s.career_games);
    const goalTarget = nearestUpcoming(goals, GOAL_TARGETS, WINDOW.goals);
    if (goalTarget) milestones.push({ playerId: s.id, playerName: s.full_name, category: "career goals", current: goals, target: goalTarget, remaining: goalTarget - goals });
    const pointTarget = nearestUpcoming(points, POINT_TARGETS, WINDOW.points);
    if (pointTarget) milestones.push({ playerId: s.id, playerName: s.full_name, category: "career points", current: points, target: pointTarget, remaining: pointTarget - points });
    const gameTarget = nearestUpcoming(games, GAME_TARGETS, WINDOW.games);
    if (gameTarget) milestones.push({ playerId: s.id, playerName: s.full_name, category: "career games played", current: games, target: gameTarget, remaining: gameTarget - games });
  }

  for (const g of goalies) {
    if (!roster.has(Number(g.id))) continue;
    if (!hasFullCareerLoaded(g.birth_date)) continue;
    const wins = Number(g.career_wins);
    const shutouts = Number(g.career_shutouts);
    const winTarget = nearestUpcoming(wins, WIN_TARGETS, WINDOW.wins);
    if (winTarget) milestones.push({ playerId: g.id, playerName: g.full_name, category: "career wins", current: wins, target: winTarget, remaining: winTarget - wins });
    const shutoutTarget = nearestUpcoming(shutouts, SHUTOUT_TARGETS, WINDOW.shutouts);
    if (shutoutTarget) milestones.push({ playerId: g.id, playerName: g.full_name, category: "career shutouts", current: shutouts, target: shutoutTarget, remaining: shutoutTarget - shutouts });
  }

  return milestones.sort((a, b) => a.remaining - b.remaining);
}

// "1 more goals" reads as a typo — singularize the category noun to match
// a remaining count of exactly 1 ("goals" -> "goal", "games played" ->
// "game played"). Shared here instead of duplicated in every page that
// renders a milestone.
export function milestoneText(m: Milestone): string {
  const category = m.category.replace("career ", "");
  const label = m.remaining === 1 ? category.replace(/s\b/, "") : category;
  return `needs ${m.remaining} more ${label} for ${m.target}`;
}
