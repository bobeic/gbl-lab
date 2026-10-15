import type { BattleState, LastDamageUpdate, Side } from '../engine/state';
import type { Action } from '../engine/turn';

/** A policy's choice for one turn, plus any PvPoke `move.damage` writes its decision made (spec §10). */
export interface PolicyDecision {
  readonly action: Action;
  readonly lastDamageUpdates?: readonly LastDamageUpdate[];
}

/** A decision-maker for one side of a battle. */
export interface Policy {
  /**
   * Choose this turn's action. Called whenever the side's cooldown is 0 in a live battle, as PvPoke calls
   * decideAction. When `canAct(state, me)` is false (e.g. the turn after a charged move) the returned action is
   * discarded and only its lastDamageUpdates apply.
   */
  chooseAction(state: BattleState, me: Side): PolicyDecision;
  /** Decide whether to shield an incoming charged move that would deal `damage`. */
  chooseShield(state: BattleState, me: Side, incomingMoveIndex: number, damage: number): boolean;
}
