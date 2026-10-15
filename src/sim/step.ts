import { IllegalActionError } from '../errors';
import { SIDES, withLastDamage, type BattleState } from '../engine/state';
import { beginTurn, canAct, resolveTurn, type Action, type BattleEvent } from '../engine/turn';
import type { Policy } from '../policy/types';

export interface StepResult {
  readonly state: BattleState;
  readonly events: readonly BattleEvent[];
}

/** Advance a live battle by one turn: tick cooldowns, ask each side's policy, then resolve the turn. */
export function step(state: BattleState, policies: readonly [Policy, Policy]): StepResult {
  if (state.over) throw new IllegalActionError(`Battle is already over at turn ${state.turn}`);
  let pre = beginTurn(state);
  const actions: [Action | null, Action | null] = [null, null];
  // PvPoke Battle.js:326-331, 720-731: each side with no cooldown decides in order, seeing the previous side's
  // move.damage writes; after a charged move the decision is still made, then discarded (Battle.js:335-337).
  for (const side of SIDES) {
    if (pre.sides[side].cooldownMs !== 0) continue;
    const decision = policies[side].chooseAction(pre, side);
    pre = withLastDamage(pre, decision.lastDamageUpdates ?? []);
    if (canAct(pre, side)) actions[side] = decision.action;
  }
  return resolveTurn(pre, actions, (s, defender, idx, dmg) => policies[defender].chooseShield(s, defender, idx, dmg));
}
