import type { BattleState, Side } from '../engine/state';
import { other } from '../engine/state';
import type { Action } from '../engine/turn';
import type { Policy } from './types';

/** Uses only fast moves and never shields. */
export class FastOnlyPolicy implements Policy {
  /** Always choose the fast move. */
  chooseAction(): Action {
    return { type: 'fast' };
  }

  /** Never shield. */
  chooseShield(): boolean {
    return false;
  }
}

/** Throws the first affordable charged move in slot order; always shields. */
export class GreedyPolicy implements Policy {
  /** Choose the first affordable charged move, else the fast move. */
  chooseAction(state: BattleState, me: Side): Action {
    const energy = state.sides[me].energy;
    const index = state.combatants[me].chargedMoves.findIndex((m) => energy >= m.energy);
    return index >= 0 ? { type: 'charged', index } : { type: 'fast' };
  }

  /** Always shield. */
  chooseShield(): boolean {
    return true;
  }
}

export interface ScriptedCharged {
  readonly side: Side;
  readonly turn: number;
  readonly index: number;
  /** Whether the opponent shields this move (PvPoke sandbox `settings.shielded`). */
  readonly shielded: boolean;
}

/** Mirrors PvPoke sandbox mode: charged moves at scripted turns if possible, otherwise fast moves. */
export class ScriptedPolicy implements Policy {
  constructor(private readonly script: readonly ScriptedCharged[]) {}

  /** Throw the scripted charged move for this turn if affordable, else the fast move. */
  chooseAction(state: BattleState, me: Side): Action {
    const entry = this.script.find((s) => s.side === me && s.turn === state.turn);
    if (!entry) return { type: 'fast' };
    const move = state.combatants[me].chargedMoves[entry.index];
    return move && state.sides[me].energy >= move.energy ? { type: 'charged', index: entry.index } : { type: 'fast' };
  }

  /** Shield when the attacker's scripted move for this turn is marked shielded. */
  chooseShield(state: BattleState, me: Side): boolean {
    const entry = this.script.find((s) => s.side === other(me) && s.turn === state.turn);
    return entry?.shielded ?? false;
  }
}
