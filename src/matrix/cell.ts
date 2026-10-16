import type { GameData } from '../data/types';
import type { Combatant } from '../engine/combatant';
import { TurnLimitError } from '../errors';
import { PvPokeLikePolicy } from '../policy/pvpoke';
import { runMatchup } from '../sim/runMatchup';

export type CellRow = readonly [number, number, number];
/** cell[aShields][bShields]: a's battle rating (0-1000) against b with that many shields each. */
export type Cell = readonly [CellRow, CellRow, CellRow];

/** One Pokémon's ratings against a list of opponents (cells[j] is against opponent j). */
export interface MatrixRow {
  readonly id: string;
  readonly cells: readonly Cell[];
}

/** Build a cell by calling `f` for every [aShields][bShields] scenario. */
export function cellFrom(f: (aShields: number, bShields: number) => number): Cell {
  const row = (sa: number): CellRow => [f(sa, 0), f(sa, 1), f(sa, 2)];
  return [row(0), row(1), row(2)];
}

function rate(gd: GameData, a: Combatant, b: Combatant, shields: [number, number], maxTurns: number | undefined): number {
  try {
    // Policies keep per-battle state (trace), so each battle gets fresh ones.
    return runMatchup(gd, a, b, { shields, maxTurns, policies: [new PvPokeLikePolicy(), new PvPokeLikePolicy()] }).ratings[0];
  } catch (err) {
    if (err instanceof TurnLimitError) {
      throw new TurnLimitError(`${a.species.id} vs ${b.species.id} at ${shields[0]}-${shields[1]}: ${err.message}`, err.events);
    }
    throw err;
  }
}

/** Simulate a against b in all 9 shield scenarios and return a's ratings. */
export function simulateCell(gd: GameData, a: Combatant, b: Combatant, options: { readonly maxTurns?: number } = {}): Cell {
  return cellFrom((sa, sb) => rate(gd, a, b, [sa, sb], options.maxTurns));
}
