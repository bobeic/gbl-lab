import type { BattleState, Side } from '../engine/state';
import type { Action } from '../engine/turn';

/** A decision-maker for one side of a battle. */
export interface Policy {
  /** Choose this turn's action; only called when the side can act. */
  chooseAction(state: BattleState, me: Side): Action;
  /** Decide whether to shield an incoming charged move that would deal `damage`. */
  chooseShield(state: BattleState, me: Side, incomingMoveIndex: number, damage: number): boolean;
}
