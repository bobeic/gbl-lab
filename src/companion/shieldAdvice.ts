import type { GameData } from '../data/types';
import type { Combatant } from '../engine/combatant';
import type { BattleState, Side } from '../engine/state';
import { PvPokeLikePolicy } from '../policy/pvpoke';
import type { Policy, PolicyDecision } from '../policy/types';
import { canAct } from '../engine/turn';
import { runMatchup } from '../sim/runMatchup';

/** Below this gap between shielding and not, the call is reported as close rather than advised. */
export const SHIELD_CLOSE_MARGIN = 50;

/** Plays like PvPoke, except that the first shield decision is forced. */
export class ForcedFirstShieldPolicy implements Policy {
  private readonly inner = new PvPokeLikePolicy();
  private asked = false;

  constructor(private readonly forced: boolean) {}

  /** Defer to PvPoke. */
  chooseAction(state: BattleState, me: Side): PolicyDecision {
    return this.inner.chooseAction(state, me);
  }

  /** Return the forced answer the first time, PvPoke's answer after that. */
  chooseShield(state: BattleState, me: Side, incomingMoveIndex: number, damage: number): boolean {
    if (this.asked) return this.inner.chooseShield(state, me, incomingMoveIndex, damage);
    this.asked = true;
    return this.forced;
  }
}

/** Plays like PvPoke, except that its first charged move is the forced one, thrown once it can afford it. */
export class ForcedFirstThrowPolicy implements Policy {
  private readonly inner = new PvPokeLikePolicy();
  private thrown = false;

  constructor(private readonly index: number) {}

  /** Swap PvPoke's first charged move for the forced one, farming energy until it's affordable. */
  chooseAction(state: BattleState, me: Side): PolicyDecision {
    const decision = this.inner.chooseAction(state, me);
    // An action chosen while the side can't act is discarded, so it doesn't count as the first throw.
    if (this.thrown || decision.action.type !== 'charged' || !canAct(state, me)) return decision;
    const forced = state.combatants[me].chargedMoves[this.index];
    if (!forced) return decision;
    if (state.sides[me].energy < forced.energy) return { ...decision, action: { type: 'fast' } };
    this.thrown = true;
    return { ...decision, action: { type: 'charged', index: this.index } };
  }

  /** Defer to PvPoke. */
  chooseShield(state: BattleState, me: Side, incomingMoveIndex: number, damage: number): boolean {
    return this.inner.chooseShield(state, me, incomingMoveIndex, damage);
  }
}

/** What to do if their next charged move is this one. */
export interface MoveShieldAdvice {
  readonly kind: 'close' | 'shield' | 'let-through';
  readonly moveId: string;
  readonly shieldRating: number;
  readonly noShieldRating: number;
  /** True for the move PvPoke-style play throws first, usually the cheaper bait. */
  readonly expectedFirst: boolean;
}

/**
 * For each of their charged moves, simulate them opening with it while I shield or don't, and advise whichever
 * rates better for me. Empty when I have no shields; a move they never get to throw is left out.
 */
export function shieldAdvice(gd: GameData, me: Combatant, opp: Combatant, shields: readonly [number, number]): MoveShieldAdvice[] {
  if (shields[0] <= 0) return [];
  const firstOf = (res: ReturnType<typeof runMatchup>) => res.events.find((e) => e.kind === 'charged' && e.side === 1);
  const unforced = firstOf(runMatchup(gd, me, opp, { shields, policies: [new PvPokeLikePolicy(), new PvPokeLikePolicy()] }));
  return opp.chargedMoves.flatMap((move, index): MoveShieldAdvice[] => {
    const run = (shield: boolean) =>
      runMatchup(gd, me, opp, { shields, policies: [new ForcedFirstShieldPolicy(shield), new ForcedFirstThrowPolicy(index)] });
    const shieldRun = run(true);
    const first = firstOf(shieldRun);
    // They can faint before affording this move; then there is nothing to advise, not a guess.
    if (first?.kind !== 'charged' || first.moveId !== move.id) return [];
    const shieldRating = shieldRun.ratings[0];
    const noShieldRating = run(false).ratings[0];
    const kind = Math.abs(shieldRating - noShieldRating) <= SHIELD_CLOSE_MARGIN ? 'close' : shieldRating > noShieldRating ? 'shield' : 'let-through';
    return [{ kind, moveId: move.id, shieldRating, noShieldRating, expectedFirst: unforced?.kind === 'charged' && unforced.moveId === move.id }];
  });
}
