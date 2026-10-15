import type { BattleState, Side } from '../../engine/state';
import type { Policy, PolicyDecision } from '../types';
import { decide } from './decide';
import { pvpokeShield } from './shield';

/** Plays like PvPoke's default simulate mode: ActionLogic.decideAction for actions, Battle.useMove's shield rule. */
export class PvPokeLikePolicy implements Policy {
  /** PvPoke's battle.logDecision messages, recorded only when constructed with `{ trace: true }`. */
  readonly trace: string[] = [];
  private readonly tracing: boolean;

  constructor(opts?: { readonly trace?: boolean }) {
    this.tracing = opts?.trace ?? false;
  }

  /** Choose this turn's action with the ported ActionLogic.decideAction, passing on its move.damage writes. */
  chooseAction(state: BattleState, me: Side): PolicyDecision {
    return decide(state, me, this.tracing ? this.trace : undefined);
  }

  /** Decide whether to shield with the ported Battle.useMove shield logic. */
  chooseShield(state: BattleState, me: Side, incomingMoveIndex: number, damage: number): boolean {
    return pvpokeShield(state, me, incomingMoveIndex, damage);
  }
}
