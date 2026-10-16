import type { ChargedMove, FastMove, StatPair } from '../../data/types';
import { moveDamage } from '../../engine/combatant';
import { clampStage } from '../../engine/damage';
import type { BattleState, LastDamageUpdate, Side } from '../../engine/state';
import type { Action } from '../../engine/turn';
import { PolicyStateError } from '../../errors';
import type { PolicyDecision } from '../types';
import { wouldShieldViews } from './shield';
import { views, type PokeView } from './view';

const FAST: Action = { type: 'fast' };

/** One node of PvPoke's turns-to-live search (ActionLogic.js:43): my HP, opponent energy, turn, my shields. */
interface LiveState {
  readonly hp: number;
  readonly opEnergy: number;
  readonly turn: number;
  readonly shields: number;
}

/** PvPoke's DP node (ActionLogic.js:1268-1278 BattleState). */
interface DPState {
  readonly energy: number;
  readonly oppHealth: number;
  readonly turn: number;
  /** Null for farm-down states, which PvPoke builds from a nonexistent field (ActionLogic.js:515, 528). */
  readonly oppShields: number | null;
  readonly moves: readonly ChargedMove[];
  /** Attack stages; clamped to ±4 in place when the state is taken off the queue (ActionLogic.js:461-463). */
  buffs: number;
  readonly chance: number;
}

/**
 * Index where PvPoke splices a new DP state: past each queued state whose turn is below (or, when `inclusive`, at)
 * `turn`. PvPoke's loops also test `DPQueue[i].hp` and `.shields` to drop dominated states, but BattleState has
 * no such fields, so those tests are always false and every state is inserted.
 */
function insertionIndex(queue: readonly DPState[], turn: number, inclusive: boolean): number {
  let i = 0;
  while (inclusive ? queue[i]!.turn <= turn : queue[i]!.turn < turn) {
    i++;
    if (i === queue.length) {
      break;
    }
  }
  return i;
}

/** Insert a DP state as PvPoke does when the queue is not empty (the farm-down state inserted first guarantees it). */
function insertState(queue: DPState[], next: DPState, inclusive: boolean): void {
  // PvPoke's empty-queue branches (632, 680, 729, 775) would use a stale hoisted `newEnergy`; they are unreachable.
  if (queue.length === 0) throw new PolicyStateError('DP queue unexpectedly empty when inserting a charged-move state');
  queue.splice(insertionIndex(queue, next.turn, inclusive), 0, next);
}

/** PvPoke's tie-break score for equal DP states: self-debuffing moves count up, guaranteed self-boosts down (590-608). */
function debuffScore(moves: readonly ChargedMove[]): number {
  let score = 0;
  for (const move of moves) {
    if (move.selfDebuffing) {
      score++;
    }
    if (move.buffs && move.buffs.chance === 1 && move.buffs.target === 'self' && move.buffs.stages[0] + move.buffs.stages[1] > 0) {
      score--;
    }
  }
  return score;
}

/** A self-debuffing move's `buffs` pair, which PvPoke dereferences unguarded. */
function stagesOf(move: ChargedMove): StatPair {
  if (!move.buffs) throw new PolicyStateError(`${move.id} is self-debuffing but has no buffs`);
  return move.buffs.stages;
}

/** Both sides' PvPoke `move.damage` values for one decision, mutable as PvPoke's move objects are. */
class DamageTable {
  private readonly charged: [number[], number[]];
  readonly writes: LastDamageUpdate[] = [];

  constructor(state: BattleState) {
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

/** Choose `me`'s action as PvPoke ActionLogic.decideAction does in default simulate mode, with the `move.damage` writes (ActionLogic.js:320, 336, and wouldShield's 1159) it makes. */
export function decide(state: BattleState, me: Side, trace?: string[]): PolicyDecision {
  const { poke, opponent } = views(state, me);
  const table = new DamageTable(state);
  const done = (action: Action): PolicyDecision => ({ action, lastDamageUpdates: table.writes });
  // PvPoke ActionLogic.wouldShield, including its `move.damage` write (ActionLogic.js:1159).
  const shieldsAgainst = (attacker: PokeView, defender: PokeView, move: ChargedMove): boolean => {
    const result = wouldShieldViews(attacker, defender, move, state.rules);
    table.write(attacker, move, result.damage);
    return result.value;
  };
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

  // PvPoke ActionLogic.js:210-234: throw a lethal Charged Move if it will faint the opponent
  if (!poke.c.settings.farmEnergy && opponent.s.shields === 0) {
    for (let n = 0; n < poke.activeChargedMoves.length; n++) {
      const move = poke.activeChargedMoves[n]!;
      const moveIndex = poke.indexOf(move);

      if (poke.s.energy >= move.energy) {
        const chargedDamage = damage(poke, opponent, move, state);

        // Don't throw self debuffing moves at this point, or if the opponent will faint from Fast Move damage
        if (opponent.s.hp <= chargedDamage && !move.selfDebuffing && (n === 0 || (n === 1 && !poke.c.settings.baitShields))
          && opponent.s.hp > pokeFastMoveDamage) {
          return done({ type: 'charged', index: moveIndex });
        }
      }
    }
  }

  // PvPoke ActionLogic.js:236-252: if the opponent is Mimikyu or has a similar mechanic, throw the fastest charged move ASAP
  if (opponent.form.formChange?.effect === 'protect' && opponent.s.shields === 0) {
    const fastest = poke.fastestChargedMove;
    if (fastest && poke.s.energy >= fastest.energy && !fastest.selfDebuffing) {
      log(() => ` uses ${fastest.name} to break opponent's ability as soon as possible.`);
      return done({ type: 'charged', index: poke.indexOf(fastest) });
    }
  }

  // PvPoke ActionLogic.js:254-363: optimize move timing to reduce free turns
  if (poke.c.settings.optimizeMoveTiming) {
    let targetCooldown = 500; // Look to throw moves when opponent is at this cooldown or lower
    const pokeCooldown = poke.fastMove.cooldownMs;
    const oppCooldown = opponent.fastMove.cooldownMs;

    if (pokeCooldown >= 2000) {
      targetCooldown = 1000;
    }

    if (pokeCooldown >= 1500 && oppCooldown === 2500) {
      targetCooldown = 1000;
    }

    if (pokeCooldown === 1000 && oppCooldown === 2000) {
      targetCooldown = 1000;
    }

    // Don't optimize timing for Pokemon with the same duration moves
    if (pokeCooldown === oppCooldown) {
      targetCooldown = 0;
    }

    // Don't optimize timing for Pokemon with longer, even duration moves (ie 4 vs 2, 3 vs 1)
    if (pokeCooldown % oppCooldown === 0 && pokeCooldown > oppCooldown) {
      targetCooldown = 0;
    }

    // Perform additional checks to execute optimal timing
    if ((opponentCooldown === 0 || opponentCooldown > targetCooldown) && targetCooldown > 0) {
      let optimizeTiming = true;

      // Don't optimize if we're about to faint from a fast move
      if (poke.s.hp <= oppFastMoveDamage) {
        optimizeTiming = false;
      }

      // Don't optimize if we'll go over 100 energy (state.queue mirrors battle.getQueuedActions())
      let queuedFastMoves = 0;
      for (const queued of state.queue) {
        if (queued.actor === me && queued.type === 'fast') {
          queuedFastMoves++;
        }
      }

      queuedFastMoves++; // Add 1 for the Fast Move we are thinking about doing

      if (poke.s.energy + poke.fastMove.energyGain * queuedFastMoves > 100) {
        optimizeTiming = false;
      }

      // Don't optimize if we have fewer turns to live than we can throw Charged Moves
      let turnsPlanned = poke.fastMove.turns + Math.floor(poke.s.energy / poke.activeChargedMoves[0]!.energy);

      if (poke.c.stats.atk < opponent.c.stats.atk) {
        turnsPlanned++;
      }

      if (turnsPlanned > turnsToLive) {
        optimizeTiming = false;
      }

      const ttl = turnsToLive;
      log(() => ` has ${ttl} turns to live`);

      // Don't optimize if we can KO with a Charged Move
      if (opponent.s.shields === 0) {
        for (const move of poke.activeChargedMoves) {
          table.write(poke, move, damage(poke, opponent, move, state));

          if (poke.s.energy >= move.energy && table.of(poke, move) >= opponent.s.hp) {
            optimizeTiming = false;
            break;
          }
        }
      }

      // Don't optimize if our opponent can KO with a Charged Move
      for (const move of opponent.activeChargedMoves) {
        const fastMovesFromCharged = Math.ceil((move.energy - opponent.s.energy) / opponent.fastMove.energyGain);
        // How many Fast Moves can the opponent get in if we do an extra move?
        const fastMovesInFastMove = Math.floor(pokeCooldown / oppCooldown);
        const turnsFromMove = fastMovesFromCharged * opponent.fastMove.turns + 1;

        table.write(opponent, move, damage(opponent, poke, move, state));

        let chargedDamage = table.of(opponent, move) + oppFastMoveDamage * fastMovesInFastMove;

        if (poke.s.shields > 0) {
          chargedDamage = 1 + oppFastMoveDamage * fastMovesInFastMove;
        }

        if (turnsFromMove <= poke.fastMove.turns && chargedDamage >= poke.s.hp) {
          optimizeTiming = false;
          break;
        }
      }

      // Don't optimize if the opponent will KO with Fast Moves it can fit into our Fast Move
      const fastMovesInFastMove = Math.floor((pokeCooldown + 500) / oppCooldown);
      if (poke.s.hp <= oppFastMoveDamage * fastMovesInFastMove) {
        optimizeTiming = false;
      }

      if (optimizeTiming) {
        log(() => ' is optimizing move timing');
        return done(FAST);
      }
    }
  }

  // PvPoke ActionLogic.js:365-386 skipped: Cramorant Gulp Missile form change (form changes unsupported).

  // PvPoke ActionLogic.js:388-437: if the opponent can't be fainted in a limited number of cycles, do a simpler selection
  const bestChargedMove = required(poke.bestChargedMove, poke, 'best charged move');
  const bestChargedDamage = damage(poke, opponent, bestChargedMove, state);
  const bestCycleDamage = bestChargedDamage + fastDamage * Math.ceil(bestChargedMove.energy / poke.fastMove.energyGain);
  let minimumCycleThreshold = 2;

  // Prefer non-debuffing moves when it will take multiple to KO
  if (bestChargedMove.selfDebuffing && bestChargedMove.energy > fastestChargedMove.energy
    && poke.dpeOf(bestChargedMove) / poke.dpeOf(fastestChargedMove) < 2) {
    minimumCycleThreshold = 1.1;
  }

  if (opponent.s.hp / bestCycleDamage > minimumCycleThreshold) {
    // It's going to take a lot of cycles to KO, so just throw the best move

    // Build up to best move
    let selectedMove = bestChargedMove;

    if (poke.activeChargedMoves.length > 1) {
      for (const move of poke.activeChargedMoves) {
        if (bestChargedMove.selfDebuffing && !move.selfDebuffing && poke.dpeOf(selectedMove) / poke.dpeOf(move) < 2) {
          selectedMove = move;
        }

        if (poke.c.settings.baitShields && opponent.s.shields > 0 && !poke.activeChargedMoves[0]!.selfDebuffing
          && shieldsAgainst(poke, opponent, move)) {
          selectedMove = poke.activeChargedMoves[0]!;
        }
      }
    }

    if (poke.s.energy < selectedMove.energy) {
      return done(FAST);
    }
    // Stack self debuffing moves
    if (selectedMove.selfDebuffing) {
      const energyToReach = poke.s.energy + Math.floor((100 - poke.s.energy) / poke.fastMove.energyGain) * poke.fastMove.energyGain;
      if (poke.s.energy < energyToReach) {
        return done(FAST);
      }
    }

    return done({ type: 'charged', index: poke.indexOf(selectedMove) });
  }

  // PvPoke ActionLogic.js:439-803: calculate the most efficient way to defeat opponent
  const stateList = planKnockout(state, poke, opponent, hasNonDebuff);
  if (stateList === null) {
    log(() => ' considered too many states, likely an infinite loop');
    return done(FAST);
  }

  // PvPoke ActionLogic.js:804-831: evaluate throwing strategy after finding optimal plan. Every DP state has chance 1
  // (the chance branches are disabled at line 560), so the DP stops at its first KO state and stateList holds at most
  // one state. The turnsToKO comparison at 817, which needs two or more, is therefore unreachable and not ported;
  // poke.turnsToKO (808) is only read there. PvPoke's needsBoost (814) is never set, so its guard at 893 always passes.
  if (stateList.length === 0) {
    return done(FAST);
  }
  if (stateList.length > 1) throw new PolicyStateError(`DP produced ${stateList.length} knockout plans; PvPoke stops at one`);
  // A copy: PvPoke mutates finalState.moves, an array other DP states may share, after the DP has finished.
  const finalMoves: ChargedMove[] = [...stateList[0]!.moves];

  // PvPoke ActionLogic.js:834-844: return if plan is the farm down
  if (finalMoves.length === 0) {
    const boostMove = getBoostMove(poke);
    if (!boostMove) {
      log(() => ' wants to farm down');
      return done(FAST);
    }
    finalMoves.push(boostMove);
    log(() => ' will force throw a boost move');
  }

  // PvPoke ActionLogic.js:846-857: find if there are any debuffing moves (PvPoke's mostExpensiveMove is never read)
  const debuffingMove = finalMoves.some((move) => move.selfDebuffing);
  const active = poke.activeChargedMoves;
  const baitShields = poke.c.settings.baitShields;
  const first = (): ChargedMove => finalMoves[0]!;

  // PvPoke ActionLogic.js:859-876: if bait shields, build up to most expensive charge move in planned move list
  if (baitShields && opponent.s.shields > 0 && active.length > 1) {
    for (let i = 1; i < active.length; i++) {
      if (poke.s.energy < active[i]!.energy && poke.dpeOf(active[i]!) > poke.dpeOf(first())) {
        let bait = true;

        // Don't go for baits if you have an effective self buffing move
        if (poke.dpeOf(active[i]!) / poke.dpeOf(active[0]!) <= 1.5 && active[0]!.selfBuffing) {
          bait = false;
        }

        if (bait) {
          log(() => ` doesn't use ${first().name} because it wants to bait`);
          return done(FAST);
        }
      }
    }
  }

  // PvPoke ActionLogic.js:878-890: don't bait if the opponent won't shield
  if (baitShields && opponent.s.shields > 0 && active.length > 1) {
    for (let i = 1; i < active.length; i++) {
      const dpeRatio = (table.of(poke, active[i]!) / active[i]!.energy) / (table.of(poke, first()) / first().energy);

      if (poke.s.energy >= active[i]!.energy && dpeRatio > 1.5) {
        if (!shieldsAgainst(poke, opponent, active[i]!)) {
          finalMoves[0] = active[i]!;
        }
      }
    }
  }

  // PvPoke ActionLogic.js:892-902: if not baiting shields or shields are down and no moves debuff, throw most damaging move first
  if (!baitShields || (opponent.s.shields === 0 && !debuffingMove)) {
    finalMoves.sort((a, b) => damage(poke, opponent, b, state) - damage(poke, opponent, a, state));
  }

  // PvPoke ActionLogic.js:904-907: if shields are up, prefer low energy moves that are more efficient
  if (opponent.s.shields > 0 && active.length > 1 && active[0]!.energy <= first().energy
    && poke.dpeOf(active[0]!) > poke.dpeOf(first()) && !active[0]!.selfDebuffing) {
    finalMoves[0] = active[0]!;
  }

  // PvPoke ActionLogic.js:909-912: if shields are down, prefer non-debuffing moves if both sides have significant HP remaining
  if (opponent.s.shields === 0 && active.length > 1 && first().selfDebuffing && first().energy > 50
    && poke.s.hp / poke.c.stats.hp > 0.5 && table.of(poke, first()) / opponent.s.hp < 0.8) {
    finalMoves[0] = active[0]!;
  }

  // PvPoke ActionLogic.js:914-917: bandaid to force more efficient move of the same energy
  if (active.length > 1 && active[0]!.energy === first().energy && poke.dpeOf(active[0]!) > poke.dpeOf(first())
    && !active[0]!.selfDebuffing) {
    finalMoves[0] = active[0]!;
  }

  // PvPoke ActionLogic.js:919-922: bandaid to force more efficient move of the similar energy if chosen move is self debuffing
  if (active.length > 1 && active[0]!.energy - 10 <= first().energy && poke.dpeOf(active[0]!) > poke.dpeOf(first())
    && first().selfDebuffing && !active[0]!.selfDebuffing) {
    finalMoves[0] = active[0]!;
  }

  // PvPoke ActionLogic.js:924-927: bandaid to force more efficient move of the similar energy if one move is self buffing
  if (active.length > 1 && active[0]!.energy - first().energy <= 5 && poke.dpeOf(active[0]!) > poke.dpeOf(first())
    && active[0]!.selfBuffing) {
    finalMoves[0] = active[0]!;
  }

  // PvPoke ActionLogic.js:929-938: don't bait with self debuffing moves
  if (baitShields && opponent.s.shields > 0 && active.length > 1) {
    for (let i = 1; i < active.length; i++) {
      if (poke.s.energy >= active[i]!.energy && poke.dpeOf(active[i]!) > poke.dpeOf(first())) {
        if (first().selfDebuffing && !active[i]!.selfDebuffing) {
          finalMoves[0] = active[i]!;
        }
      }
    }
  }

  // PvPoke ActionLogic.js:940-947: when shields are down, don't use self debuffing moves that are significantly less efficient
  if (opponent.s.shields === 0 && active.length > 1 && first().selfDebuffing) {
    for (let i = 1; i < active.length; i++) {
      if (poke.dpeOf(active[i]!) > poke.dpeOf(first()) && !active[i]!.selfDebuffing) {
        finalMoves[0] = active[i]!;
      }
    }
  }

  // PvPoke ActionLogic.js:949-965: while shields are up, prefer close non debuffing moves where debuffing move won't KO
  if (opponent.s.shields > 0 && active.length > 1) {
    for (let i = 1; i < active.length; i++) {
      if (active[0]!.selfDebuffing && !active[i]!.selfDebuffing) {
        // Is the Pokemon baiting or will the self debuffing move not come close to a KO?
        if (baitShields || opponent.s.hp - table.of(poke, active[0]!) > 10) {
          // Is the second move close in energy and dpe?
          if (active[i]!.energy - active[0]!.energy <= 10 && poke.dpeOf(active[i]!) / poke.dpeOf(active[0]!) > 0.7) {
            finalMoves[0] = active[i]!;
          }
        }
      }
    }
  }

  // PvPoke ActionLogic.js:967-973: defer self debuffing moves until after survivable Charged Moves
  const opponentBest = opponent.bestChargedMove;
  if (first().selfDebuffing && poke.s.shields === 0 && poke.s.energy < 100 && opponentBest) {
    if (opponent.s.energy >= opponentBest.energy && !shieldsAgainst(opponent, poke, opponentBest) && !active[0]!.selfBuffing) {
      log(() => ' is deferring its self debuffing move until after the opponent fires its move');
      return done(FAST);
    }
  }

  // PvPoke ActionLogic.js:975-992: if move is self debuffing and doesn't KO, try to stack as much as you can
  // (the Cramorant gulping/gorging opponent condition is skipped: form changes unsupported)
  if (first().selfDebuffing) {
    const targetEnergy = Math.floor(100 / first().energy) * first().energy;

    if (poke.s.energy < targetEnergy) {
      const chargedDamage = damage(poke, opponent, first(), state);
      if ((opponent.s.hp > chargedDamage || opponent.s.shields !== 0)
        && (poke.s.hp > table.of(opponent, opponent.fastMove) * 2 || opponent.fastMove.cooldownMs - poke.fastMove.cooldownMs > 500)) {
        log(() => ` doesn't use ${first().name} because it wants to minimize time debuffed and it can stack the move ${Math.floor(100 / first().energy)} times`);
        return done(FAST);
      }
    } else if (baitShields && opponent.s.shields > 0 && active[0]!.energy - first().energy <= 10 && !active[0]!.selfDebuffing) {
      // Use the lower energy move if it's a boosting move or if the opponent would shield the bigger move
      if (active[0]!.selfBuffing || shieldsAgainst(poke, opponent, first())) {
        finalMoves[0] = active[0]!;
      }
    }
  }

  // PvPoke ActionLogic.js:994-1011: use the final move, or a Fast Move if not enough energy
  if (poke.s.energy >= first().energy) {
    if (finalMoves.length > 1) {
      log(() => ` uses ${first().name} because it thinks that using ${finalMoves.length - 1} moves afterwards is the best plan.`);
      for (let i = 1; i < finalMoves.length; i++) {
        const [next, prev] = [finalMoves[i]!, finalMoves[i - 1]!];
        log(() => ` wants to use ${next.name} after it uses ${prev.name}`);
      }
    } else {
      log(() => ` uses ${first().name} at turn ${state.turn} because it KO's or it wants to farm down afterwards`);
    }
  } else {
    log(() => ` uses a fast move because it has no energy for ${first().name}`);
    return done(FAST);
  }

  // PvPoke ActionLogic.js:1013-1022 skipped: Aegislash shield-form energy building (form changes unsupported).

  // PvPoke ActionLogic.js:1024-1031
  return done({ type: 'charged', index: poke.indexOf(first()) });
}

/** PvPoke Pokemon.getBoostMove (Pokemon.js:1876-1890): the last slot-order move with a likely, non-debuffing buff. */
function getBoostMove(poke: PokeView): ChargedMove | null {
  let boostMove: ChargedMove | null = null;
  for (const move of poke.chargedMoves) {
    if (move.buffs && move.buffs.chance >= 0.5 && !move.selfDebuffing) {
      boostMove = move;
    }
  }
  return boostMove;
}

/**
 * PvPoke's DP over (energy, opponent HP, turns, opponent shields, moves, attack buffs, chance), ActionLogic.js:439-803.
 * Returns PvPoke's stateList, or null when it gives up after 500 states (ActionLogic.js:451-455).
 */
function planKnockout(state: BattleState, poke: PokeView, opponent: PokeView, hasNonDebuff: boolean): DPState[] | null {
  const { energyGain, turns } = poke.fastMove;
  // ELEMENTS OF DP QUEUE: ENERGY, OPPONENT HEALTH, TURNS, OPPONENT SHIELDS, USED MOVES, ATTACK BUFF, CHANCE
  let stateCount = 0;

  const DPQueue: DPState[] = [{
    energy: poke.s.energy, oppHealth: opponent.s.hp, turn: 0, oppShields: opponent.s.shields, moves: [], buffs: 0, chance: 1,
  }];
  const stateList: DPState[] = [];

  while (DPQueue.length !== 0) {
    // A not very good way to prevent infinite loops
    if (stateCount >= 500) {
      return null;
    }
    stateCount++;

    const currState = DPQueue.shift()!;
    const DPchargedMoveReady: number[] = [];

    // Set cap of 4 for buffs
    currState.buffs = Math.min(4, currState.buffs);
    currState.buffs = Math.max(-4, currState.buffs);

    // Found fastest way to defeat enemy, fastest = optimal in this case since damage taken is strictly dependent on time
    // Set finalState to currState and do more evaluation later
    if (currState.oppHealth <= 0) {
      stateList.push(currState);

      if (currState.chance === 1) {
        break;
      } else {
        continue;
      }
    }

    const oppShields = currState.oppShields;
    if (oppShields === null) throw new PolicyStateError('A farm-down DP state with opponent HP left was expanded');

    // Evaluate cooldown to reach each charge move
    for (const move of poke.activeChargedMoves) {
      if (currState.energy >= move.energy) {
        DPchargedMoveReady.push(0);
      } else {
        DPchargedMoveReady.push(Math.ceil((move.energy - currState.energy) / energyGain) * turns);
      }
    }

    // Push states onto queue in order of TURN
    for (let n = 0; n < poke.activeChargedMoves.length; n++) {
      const move = poke.activeChargedMoves[n]!;

      // Apply stat changes to pokemon attack (PvPoke applyStatBuffs, then resets; computed on a local stage here)
      const attackStage = clampStage(poke.s.buffs[0] + currState.buffs, state.rules.maxBuffStages);
      const moveDamage = damage(poke, opponent, move, state, attackStage);
      const fastSimulatedDamage = damage(poke, opponent, poke.fastMove, state, attackStage);

      // Skip self defense debuffing moves like Superpower if they aren't lethal
      // MELMETAL V CRESSELIA IS A NIGHTMARE :D
      if (hasNonDebuff && poke.c.species.name === 'Melmetal' && opponent.c.species.name === 'Cresselia') {
        if (move.selfDebuffing && stagesOf(move)[1] < 1 && opponent.s.hp > moveDamage * (1 + 4 / (4 - stagesOf(move)[0]))) {
          continue;
        }
      }

      // Add result of farming down from this point. PvPoke reads the nonexistent `currState.opponentShields` (515, 528);
      // PvPoke's `DPQueue[i].hp < 0` test (518) reads a field BattleState lacks, so it never blocks the insert.
      const movesToFarmDown = Math.ceil(currState.oppHealth / fastSimulatedDamage);
      const farmDown: DPState = {
        energy: currState.energy + energyGain * movesToFarmDown, oppHealth: 0, turn: currState.turn + movesToFarmDown * turns,
        oppShields: null, moves: currState.moves, buffs: currState.buffs, chance: currState.chance,
      };

      // Place state at correct spot in priority queue
      if (DPQueue.length === 0) {
        DPQueue.unshift(farmDown);
      } else {
        DPQueue.splice(insertionIndex(DPQueue, farmDown.turn, true), 0, farmDown);
      }

      // Find new attack after move
      let attackMult = currState.buffs;

      // If attack changes attack stat, apply effects. PvPoke also tracks a possible (chance) multiplier here,
      // but disables the non-guaranteed buff evaluation (changeTTKChance = 0, line 560), so it is never used.
      const buffs = move.buffs;
      if (buffs && buffs.chance && buffs.target === 'self') {
        if (buffs.chance === 1) {
          attackMult += buffs.stages[0];
        }
      }

      // If attack changes opponent defense, apply effects
      if (buffs && buffs.chance && buffs.target === 'opponent') {
        if (buffs.chance === 1) {
          attackMult -= buffs.stages[1];
        }
      }

      const moves = [...currState.moves, move];
      const stacks = move.selfDebuffing && stagesOf(move)[0] < 0 && move.energy * 2 <= 100;

      // If move is ready, use it and add results to queue
      if (DPchargedMoveReady[n] === 0) {
        // If shielded, apply 1 damage, otherwise apply move damage
        let newOppHealth = currState.oppHealth - moveDamage;
        if (oppShields > 0) {
          newOppHealth = currState.oppHealth - 1;
        }

        let newShields = oppShields;
        // Assume pokemon shields
        if (newShields > 0) {
          newShields--;
        }

        // Remove all elements that are strictly worse than this state while checking if there are any elements better
        let i = 0;
        let insertElement = true;
        while (i < DPQueue.length && DPQueue[i]!.turn === currState.turn + 1) {
          const queued = DPQueue[i]!;
          if (queued.oppHealth === newOppHealth && queued.buffs === attackMult) {
            if (queued.energy === currState.energy - move.energy) {
              // Added this just for Perrserker and Giratina
              // If energy is the same and opponent at same health choose path with less debuffs or more buff chances
              if (debuffScore(queued.moves) > debuffScore(moves)) {
                DPQueue.splice(i, 1);
              } else {
                insertElement = false;
                i++;
              }
            } else {
              insertElement = false;
              i++;
            }
          } else {
            i++;
          }
        }

        if (insertElement) {
          // Place state at correct spot in priority queue (PvPoke's dominance test at 639 reads the missing hp/shields)
          insertState(DPQueue, {
            energy: currState.energy - move.energy, oppHealth: newOppHealth, turn: currState.turn + 1, oppShields: newShields,
            moves, buffs: attackMult, chance: currState.chance,
          }, true);
        }

        // If move will debuff attack, calculate values when you stack two of them then throw
        if (stacks) {
          let newTurn = Math.ceil((move.energy * 2 - currState.energy) / energyGain) * turns;
          const newEnergy = Math.floor(newTurn / turns) * energyGain + currState.energy - move.energy;

          if (newTurn !== 0) {
            // Calculate new health
            newOppHealth = currState.oppHealth - fastSimulatedDamage * (newTurn / turns);

            // Calculate shield scenarios
            if (oppShields > 0) {
              newOppHealth = newOppHealth - 1;
            } else {
              newOppHealth = newOppHealth - moveDamage;
            }

            newTurn += currState.turn + 1;

            insertState(DPQueue, {
              energy: newEnergy, oppHealth: newOppHealth, turn: newTurn, oppShields: newShields, moves, buffs: attackMult,
              chance: currState.chance,
            }, true);
          }
        }
      } else {
        const ready = DPchargedMoveReady[n]!;
        let newEnergy = currState.energy - move.energy + energyGain * (ready / turns);
        let newOppHealth = currState.oppHealth - moveDamage - fastSimulatedDamage * (ready / turns);

        // If shields are up, only apply fast move damage
        if (oppShields > 0) {
          newOppHealth = currState.oppHealth - fastSimulatedDamage * (ready / turns) - 1;
        }
        let newTurn = currState.turn + ready + 1;
        let newShields = oppShields;

        // Assume pokemon shields
        if (newShields > 0) {
          newShields--;
        }

        // Place in priority queue, with TURN being the priority
        insertState(DPQueue, {
          energy: newEnergy, oppHealth: newOppHealth, turn: newTurn, oppShields: newShields, moves, buffs: attackMult,
          chance: currState.chance,
        }, false);

        // If move will debuff attack, calculate values when you stack two of them then throw
        if (stacks) {
          newTurn = Math.ceil((move.energy * 2 - currState.energy) / energyGain) * turns;
          newEnergy = Math.floor(newTurn / turns) * energyGain + currState.energy - move.energy;

          // Calculate new health
          newOppHealth = currState.oppHealth - fastSimulatedDamage * (newTurn / turns);

          // Calculate shield scenarios
          if (oppShields > 0) {
            newOppHealth = newOppHealth - 1;
          } else {
            newOppHealth = newOppHealth - moveDamage;
          }

          newTurn += currState.turn + 1;

          insertState(DPQueue, {
            energy: newEnergy, oppHealth: newOppHealth, turn: newTurn, oppShields: newShields, moves, buffs: attackMult,
            chance: currState.chance,
          }, false);
        }
      }
    }
  }

  return stateList;
}
