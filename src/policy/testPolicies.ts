import type { BattleState, Side } from '../engine/state';
import { other } from '../engine/state';
import type { PolicyDecision, Policy } from './types';

/** Uses only fast moves and never shields. */
export class FastOnlyPolicy implements Policy {
  /** Always choose the fast move. */
  chooseAction(): PolicyDecision {
    return { action: { type: 'fast' } };
  }

  /** Never shield. */
  chooseShield(): boolean {
    return false;
  }
}

/** Throws the first affordable charged move in slot order; always shields. */
export class GreedyPolicy implements Policy {
  /** Choose the first affordable charged move, else the fast move. */
  chooseAction(state: BattleState, me: Side): PolicyDecision {
    const energy = state.sides[me].energy;
    const index = state.combatants[me].chargedMoves.findIndex((m) => energy >= m.energy);
    return { action: index >= 0 ? { type: 'charged', index } : { type: 'fast' } };
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

  /** The script entry PvPoke acts on for this side and turn, or undefined when none applies. */
  private entryFor(state: BattleState, side: Side): ScriptedCharged | undefined {
    const moveCount = state.combatants[side].chargedMoves.length;
    // PvPoke Battle.getTurnAction (Battle.js:740-760) scans every action and keeps the last match;
    // entries whose index exceeds the moveset are skipped, an unaffordable last match falls back to a fast move.
    let entry: ScriptedCharged | undefined;
    for (const s of this.script) {
      if (s.side === side && s.turn === state.turn && s.index < moveCount) entry = s;
    }
    return entry;
  }

  /** Throw the scripted charged move for this turn if affordable, else the fast move. */
  chooseAction(state: BattleState, me: Side): PolicyDecision {
    const entry = this.entryFor(state, me);
    if (!entry) return { action: { type: 'fast' } };
    const move = state.combatants[me].chargedMoves[entry.index]!;
    return { action: state.sides[me].energy >= move.energy ? { type: 'charged', index: entry.index } : { type: 'fast' } };
  }

  /** Shield when the attacker's scripted move for this turn is marked shielded. */
  chooseShield(state: BattleState, me: Side): boolean {
    return this.entryFor(state, other(me))?.shielded ?? false;
  }
}
