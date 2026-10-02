// "On pace for" on the player page, for the season in progress.
//
// Projection = what he has + his rate this season x his team's remaining
// regular-season games. Not "rate x full season": that quietly assumes he
// already played every game he missed (20 goals in 30 GP, team 35 games
// in, 84-game season: rate x 84 says 56, but only 49 games are left, so
// the honest number is 20 + 0.667 x 49 = 53). It does assume he plays every
// remaining game at his current rate, and the page says so.
//
// Goalies are projected on wins per TEAM game (their share of the starts
// is part of the rate). Shown only from PACE_MIN_GAMES games on: before
// that a rate is mostly noise.

export const PACE_MIN_GAMES = 20;

export type SkaterPace = { kind: "skater"; gp: number; goals: number; points: number; paceGoals: number; pacePoints: number; remaining: number };
export type GoaliePace = { kind: "goalie"; gp: number; wins: number; paceWins: number; remaining: number };

export function skaterPace(s: { gp: number; goals: number; points: number; teamGamesPlayed: number; seasonGames: number }): SkaterPace | null {
  if (s.gp < PACE_MIN_GAMES || s.seasonGames <= 0) return null;
  const remaining = Math.max(0, s.seasonGames - s.teamGamesPlayed);
  return {
    kind: "skater",
    gp: s.gp,
    goals: s.goals,
    points: s.points,
    paceGoals: Math.round(s.goals + (s.goals / s.gp) * remaining),
    pacePoints: Math.round(s.points + (s.points / s.gp) * remaining),
    remaining,
  };
}

export function goaliePace(s: { gp: number; wins: number; teamGamesPlayed: number; seasonGames: number }): GoaliePace | null {
  if (s.gp < PACE_MIN_GAMES || s.teamGamesPlayed <= 0 || s.seasonGames <= 0) return null;
  const remaining = Math.max(0, s.seasonGames - s.teamGamesPlayed);
  return { kind: "goalie", gp: s.gp, wins: s.wins, paceWins: Math.round(s.wins + (s.wins / s.teamGamesPlayed) * remaining), remaining };
}
