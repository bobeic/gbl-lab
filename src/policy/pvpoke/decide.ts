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

/** One node of PvPoke's turns-to-live search (ActionLogic.js:43): my HP, opponent energy, turn, my shields. */
interface LiveState {
  readonly hp: number;
  readonly opEnergy: number;
  readonly turn: number;
  readonly shields: number;
}

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

  // PvPoke ActionLogic.js:38-63: check if opponent is in the middle of a fast move and adjust accordingly
  let turnsToLive = Infinity;
  const queue: LiveState[] = [];
  const opponentCooldown = opponent.s.cooldownMs;

  if (opponentCooldown !== 0) {
    queue.unshift({
      hp: poke.s.hp - oppFastDamage,
      opEnergy: opponent.s.energy + opponent.fastMove.energyGain,
      turn: opponentCooldown / 500,
      shields: poke.s.shields,
    });
  } else {
    queue.unshift({ hp: poke.s.hp, opEnergy: opponent.s.energy, turn: 0, shields: poke.s.shields });
  }

  // PvPoke ActionLogic.js:65-139: check if opponent can KO in your fast move cooldown
  const opponentFastest = required(opponent.fastestChargedMove, opponent, 'fastest charged move');
  for (let currState = queue.shift(); currState !== undefined; currState = queue.shift()) {
    // If turn > when you can act before your opponent, move to the next item in the queue
    if (currState.hp > oppFastDamage) {
      if (winsCMP) {
        if (currState.turn > poke.fastMove.turns) {
          continue;
        }
      } else if (currState.turn > poke.fastMove.turns + 1) {
        continue;
      }
    }

    // Shield bait if shields are up, otherwise try to KO
    if (currState.shields !== 0) {
      if (currState.opEnergy >= opponentFastest.energy) {
        queue.unshift({
          hp: currState.hp - 1,
          opEnergy: currState.opEnergy - opponentFastest.energy,
          turn: currState.turn + 1,
          shields: currState.shields - 1,
        });
      }
    } else {
      // Check if any charge move KO's, add results to queue
      for (const move of opponent.activeChargedMoves) {
        if (currState.opEnergy >= move.energy) {
          const chargedDamage = damage(opponent, poke, move, state);

          if (chargedDamage >= currState.hp) {
            turnsToLive = Math.min(currState.turn, turnsToLive);

            if (poke.c.stats.atk > opponent.c.stats.atk && opponent.fastMove.cooldownMs % poke.fastMove.cooldownMs === 0) {
              turnsToLive++;
            }

            const ttl = turnsToLive;
            const opEnergy = currState.opEnergy;
            log(() => ` opponent has energy to use ${move.name} and it would do ${chargedDamage} damage. I have ${ttl} turn(s) to live, opponent has ${opEnergy}`);
            break;
          }
          queue.unshift({
            hp: currState.hp - chargedDamage,
            opEnergy: currState.opEnergy - move.energy,
            turn: currState.turn + 1,
            shields: currState.shields,
          });
        }
      }
    }

    // Check if a fast move faints, add results to queue
    if (currState.hp - oppFastDamage <= 0) {
      turnsToLive = Math.min(currState.turn + opponent.fastMove.turns, turnsToLive);
      break;
    } else {
      queue.unshift({
        hp: currState.hp - oppFastDamage,
        opEnergy: currState.opEnergy + opponent.fastMove.energyGain,
        turn: currState.turn + opponent.fastMove.turns,
        shields: currState.shields,
      });
    }
  }

  // PvPoke ActionLogic.js:141-208: if you can't throw a fast move and live, throw whatever move you can with the most damage
  // (PvPoke tests `turnsToLive != -1`, which always holds: it starts at Infinity and only takes turn counts.)
  const oppFastMoveDamage = table.of(opponent, opponent.fastMove);
  const pokeFastMoveDamage = table.of(poke, poke.fastMove);
  if (poke.s.hp <= oppFastMoveDamage * 2 && opponent.fastMove.cooldownMs === 500) {
    turnsToLive--;
  }

  // Anticipate a Fast Move landing that has already initiated
  if (poke.s.hp <= oppFastMoveDamage && opponentCooldown > 0 && opponent.fastMove.cooldownMs > 500) {
    turnsToLive = opponentCooldown / 500;

    if (opponent.s.hp > pokeFastMoveDamage) {
      turnsToLive--;
    }
  }

  // Anticipate a Fast Move landing if you use your Fast Move
  if (poke.s.hp <= oppFastMoveDamage && opponentCooldown === 0 && opponent.fastMove.cooldownMs <= poke.fastMove.cooldownMs + 500) {
    if (opponent.s.hp > pokeFastMoveDamage) {
      turnsToLive--;
    }
  }

  if (turnsToLive * 500 < poke.fastMove.cooldownMs
    || (turnsToLive * 500 === poke.fastMove.cooldownMs && !winsCMP)
    || (turnsToLive * 500 === poke.fastMove.cooldownMs && poke.s.hp <= oppFastMoveDamage)) {
    let maxDamageMoveIndex = 0;
    let prevMoveDamage = -1;

    // PvPoke starts at n = activeChargedMoves.length, where chargedMoveReady[n] is undefined and the entry is skipped.
    for (let n = poke.activeChargedMoves.length - 1; n >= 0; n--) {
      // Find highest damage available move
      if (chargedMoveReady[n] === 0) {
        const move = poke.activeChargedMoves[n]!;
        const chargedDamage = damage(poke, opponent, move, state);

        // If this move deals more damage than the other move, use it
        if (chargedDamage > prevMoveDamage) {
          maxDamageMoveIndex = poke.indexOf(move);
          prevMoveDamage = chargedDamage;
        }

        // If the Pokemon can fire two of this move and deal more damage, use it
        if (poke.s.energy >= move.energy * 2 && poke.c.stats.atk > opponent.c.stats.atk && chargedDamage * 2 > prevMoveDamage) {
          maxDamageMoveIndex = poke.indexOf(move);
          prevMoveDamage = chargedDamage * 2;
        }
      }
    }

    // If no moves available, throw fast move
    const ttl = turnsToLive;
    if (prevMoveDamage === -1) {
      log(() => ` uses a fast move because it has ${ttl} turn(s) before it is KO'd but has no energy.`);
      return done(FAST);
    }
    // Throw highest damage move
    log(() => ` uses ${poke.chargedMoves[maxDamageMoveIndex]!.name} because it has ${ttl} turn(s) before it is KO'd.`);
    return done({ type: 'charged', index: maxDamageMoveIndex });
  }

  return done(FAST);
}
