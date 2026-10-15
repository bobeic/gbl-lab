import type { ChargedMove, FastMove } from '../../data/types';
import { moveDamage } from '../../engine/combatant';
import type { BattleState, Side } from '../../engine/state';
import type { Action } from '../../engine/turn';
import { PolicyStateError } from '../../errors';
import { views, type PokeView } from './view';

/** A PvPoke `move.damage` write made inside decideAction (ActionLogic.js:320, 336 and wouldShield's 1159). */
export interface LastDamageWrite {
  readonly side: Side;
  readonly chargedIndex: number;
  readonly damage: number;
}

/** decideAction's chosen action plus the `move.damage` writes PvPoke would leave behind on its move objects. */
export interface Decision {
  readonly action: Action;
  readonly lastDamageWrites: readonly LastDamageWrite[];
}

const FAST: Action = { type: 'fast' };

/** Both sides' PvPoke `move.damage` values for one decision, mutable as PvPoke's move objects are. */
class DamageTable {
  private readonly charged: [number[], number[]];
  readonly writes: LastDamageWrite[] = [];

  constructor(private readonly state: BattleState) {
    this.charged = [[...state.sides[0].lastDamage.charged], [...state.sides[1].lastDamage.charged]];
  }

  /** PvPoke `move.damage` for a side's fast or charged move. */
  of(view: PokeView, move: FastMove | ChargedMove): number {
    if (move.kind === 'fast') return view.damageOf(move);
    const damage = this.charged[view.side][view.indexOf(move)];
    if (damage === undefined) throw new PolicyStateError(`${view.c.species.id}: no damage recorded for ${move.id}`);
    return damage;
  }

  /** Mirror PvPoke assigning `move.damage` on a charged move. */
  write(view: PokeView, move: ChargedMove, damage: number): void {
    const chargedIndex = view.indexOf(move);
    this.charged[view.side][chargedIndex] = damage;
    this.writes.push({ side: view.side, chargedIndex, damage });
  }
}

/** PvPoke DamageCalculator.damage(attacker, defender, move) at current buffs, optionally with another attack stage. */
function damage(attacker: PokeView, defender: PokeView, move: FastMove | ChargedMove, state: BattleState,
  attackStage: number = attacker.s.buffs[0]): number {
  return moveDamage(attacker.c, attackStage, defender.c, defender.s.buffs[1], move, state.rules.buffDivisor);
}

/** A move PvPoke dereferences without a null check; throws if the view lacks it. */
function required(move: ChargedMove | null, view: PokeView, what: string): ChargedMove {
  if (!move) throw new PolicyStateError(`${view.c.species.id} has no ${what}`);
  return move;
}

/** Choose `me`'s action this turn as PvPoke ActionLogic.decideAction does in default simulate mode. */
export function decideAction(state: BattleState, me: Side, trace?: string[]): Action {
  return decide(state, me, trace).action;
}

/** decideAction, also returning the `move.damage` writes PvPoke's decision makes. */
export function decide(state: BattleState, me: Side, trace?: string[]): Decision {
  const { poke, opponent } = views(state, me);
  const table = new DamageTable(state);
  const done = (action: Action): Decision => ({ action, lastDamageWrites: table.writes });
  const log = (message: () => string): void => {
    if (trace) trace.push(`turn ${state.turn} side ${me}:${message()}`);
  };

  // PvPoke ActionLogic.js:6-14
  const chargedMoveReady: number[] = []; // Array containing how many turns to reach active charged attacks
  const winsCMP = poke.c.stats.atk >= opponent.c.stats.atk;

  const fastDamage = damage(poke, opponent, poke.fastMove, state);
  const oppFastDamage = damage(opponent, poke, opponent.fastMove, state);
  let hasNonDebuff = false;

  // PvPoke ActionLogic.js:16-19: if no Charged Moves at all, return
  if (poke.activeChargedMoves.length < 1) {
    return done(FAST);
  }

  // PvPoke ActionLogic.js:21-24: if no charged move ready or farm energy is on, always throw fast move
  const fastestChargedMove = required(poke.fastestChargedMove, poke, 'fastest charged move');
  if (poke.s.energy < fastestChargedMove.energy || poke.c.settings.farmEnergy) {
    return done(FAST);
  }

  // PvPoke ActionLogic.js:26-36: evaluate cooldown to reach each charge move
  for (const move of poke.activeChargedMoves) {
    if (!move.selfDebuffing) {
      hasNonDebuff = true;
    }
    if (poke.s.energy >= move.energy) {
      chargedMoveReady.push(0);
    } else {
      chargedMoveReady.push(Math.ceil((move.energy - poke.s.energy) / poke.fastMove.energyGain) * poke.fastMove.turns);
    }
  }

  return done(FAST);
}
