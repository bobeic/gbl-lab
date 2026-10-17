import type { GameData } from '../data/types';
import type { Combatant } from '../engine/combatant';
import { simulateCell, type Cell } from '../matrix/cell';

/** Below this the Pokémon on the field is losing, and a switch can be suggested... */
export const SWITCH_WIN_LINE = 500;
/** ...to a teammate that beats it by at least this much, even if that teammate doesn't win outright. */
export const SWITCH_MIN_MARGIN = 100;

/** Green above 550, amber (coin flip) from 450 to 550, red below 450. */
export type RatingBand = 'win' | 'close' | 'loss';

/** Classify a 0-1000 rating for coloring. */
export function ratingBand(r: number): RatingBand {
  if (r > 550) return 'win';
  if (r >= 450) return 'close';
  return 'loss';
}

/** Simulate each team member against the opponent in all 9 shield scenarios. */
export function teamCells(gd: GameData, team: readonly Combatant[], opp: Combatant): Cell[] {
  return team.map((c) => simulateCell(gd, c, opp));
}

/** The user's rating with these shields on each side. */
export function ratingAt(cell: Cell, myShields: number, theirShields: number): number {
  const r = cell[myShields]?.[theirShields];
  if (r === undefined) throw new RangeError(`Shields must be 0-2, got ${myShields}-${theirShields}`);
  return r;
}

export type StaySwitch =
  | { kind: 'stay'; slot: number; rating: number }
  | { kind: 'switch'; from: number; to: number; fromRating: number; toRating: number }
  | { kind: 'none' };

/** Non-fainted team slots, best rating first, ties by slot order. */
export function rankSlots(ratings: readonly number[], fainted: readonly boolean[]): number[] {
  return ratings
    .map((_, slot) => slot)
    .filter((slot) => !fainted[slot])
    .sort((a, b) => ratings[b]! - ratings[a]! || a - b);
}

/** Suggest switching only when losing and a living teammate does clearly better; otherwise stay. */
export function staySwitch(ratings: readonly number[], onField: number | null, fainted: readonly boolean[]): StaySwitch {
  if (onField === null || fainted[onField]) return { kind: 'none' };
  const current = ratings[onField];
  if (current === undefined) return { kind: 'none' };
  const stay: StaySwitch = { kind: 'stay', slot: onField, rating: current };
  if (current >= SWITCH_WIN_LINE) return stay;
  const best = rankSlots(ratings, fainted).find((slot) => slot !== onField);
  if (best === undefined) return stay;
  const bestRating = ratings[best]!;
  if (bestRating - current < SWITCH_MIN_MARGIN) return stay;
  return { kind: 'switch', from: onField, to: best, fromRating: current, toRating: bestRating };
}
