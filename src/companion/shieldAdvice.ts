import type { GameData } from '../data/types';
import type { Combatant } from '../engine/combatant';
import type { BattleState, Side } from '../engine/state';
import { PvPokeLikePolicy } from '../policy/pvpoke';
import type { Policy, PolicyDecision } from '../policy/types';
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

export type ShieldAdvice =
  | { kind: 'none' }
  | { kind: 'close'; moveId: string; shieldRating: number; noShieldRating: number }
  | { kind: 'shield' | 'let-through'; moveId: string; shieldRating: number; noShieldRating: number };

/** Simulate shielding and not shielding their first charged move, and advise whichever rates better for me. */
export function shieldAdvice(gd: GameData, me: Combatant, opp: Combatant, shields: readonly [number, number]): ShieldAdvice {
  if (shields[0] <= 0) return { kind: 'none' };
  const run = (forced: boolean) =>
    runMatchup(gd, me, opp, { shields, policies: [new ForcedFirstShieldPolicy(forced), new PvPokeLikePolicy()] });
  const shieldRun = run(true);
  const first = shieldRun.events.find((e) => e.kind === 'charged' && e.side === 1);
  // No charged move from them means there is nothing to advise, not a guess.
  if (first?.kind !== 'charged') return { kind: 'none' };
  const shieldRating = shieldRun.ratings[0];
  const noShieldRating = run(false).ratings[0];
  const base = { moveId: first.moveId, shieldRating, noShieldRating };
  if (Math.abs(shieldRating - noShieldRating) <= SHIELD_CLOSE_MARGIN) return { kind: 'close', ...base };
  return { kind: shieldRating > noShieldRating ? 'shield' : 'let-through', ...base };
}
