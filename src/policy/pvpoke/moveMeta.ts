import type { ChargedMove } from '../../data/types';
import type { Combatant } from '../../engine/combatant';
import type { SideState } from '../../engine/state';
import { GameDataError } from '../../errors';

/** PvPoke move.dpe as Pokemon.initializeMove sets it: damage per energy, scaled up for stat-boosting moves. */
export function dpe(move: ChargedMove, damage: number, buffDivisor: number): number {
  // PvPoke Pokemon.js:893-913
  if (move.energy <= 0) throw new GameDataError(`${move.id}: charged move has no energy cost, so no DPE`);
  let value = damage / move.energy;

  if (move.buffs) {
    let buffEffect = 0;

    if (move.buffs.target === 'self' && move.buffs.stages[0] > 0) {
      buffEffect = move.buffs.stages[0] * (80 / move.energy); // PvPoke: rough number of uses per battle
    } else if (move.buffs.target === 'opponent' && move.buffs.stages[1] < 0) {
      buffEffect = Math.abs(move.buffs.stages[1]) * (80 / move.energy);
    }

    let multiplier = 1;

    if (buffEffect > 0) {
      multiplier = (buffDivisor + buffEffect * move.buffs.chance) / buffDivisor;
    }

    value *= multiplier;
  }
  return value;
}

/** A charged move with the mutable damage/DPE PvPoke keeps on the move object while ordering. */
interface Entry {
  move: ChargedMove;
  readonly damage: number;
  dpe: number;
}

/** Move entry 0 to the back, as PvPoke's `splice(0, 1)` + `push` does. */
function rotate(active: Entry[]): void {
  const first = active.shift();
  if (first) active.push(first);
}

/** Focus Blast as PvPoke rewrites it for the Zap Cannon Registeel clause (Pokemon.js:782-784). */
function asSelfDebuffing(move: ChargedMove): ChargedMove {
  // PvPoke sets buffs/buffTarget but leaves buffApplyChance undefined; NaN reproduces its comparisons (all false).
  return { ...move, buffs: { stages: [0, 0], target: 'self', chance: Number.NaN }, selfDebuffing: true };
}

/** Focus Blast with the clause's buffs, buffTarget and selfDebuffing deleted (Pokemon.js:786-788). */
function withoutBuffs(move: ChargedMove): ChargedMove {
  const { buffs: _deleted, ...rest } = move;
  return { ...rest, selfDebuffing: false };
}

/**
 * Order a side's charged moves and pick its best and fastest move, as PvPoke Pokemon.resetMoves does.
 * `s` must be the side's start-of-battle state: PvPoke runs resetMoves once, at Battle.start, with native buffs.
 */
export function orderChargedMoves(
  c: Combatant, s: SideState, buffDivisor: number,
): { active: ChargedMove[]; best: ChargedMove | null; fastest: ChargedMove | null } {
  // PvPoke Pokemon.js:711-722 (move pool damage/DPE from initializeMove)
  const active: Entry[] = [];

  // PvPoke Pokemon.js:726-750 (buff meters are engine state; see createBattle)
  c.chargedMoves.forEach((move, i) => {
    const damage = s.lastDamage.charged[i];
    if (damage === undefined) throw new GameDataError(`${c.species.id}: no damage recorded for ${move.id}`);
    active.push({ move, damage, dpe: dpe(move, damage, buffDivisor) });
  });

  if (active.length === 0) {
    // PvPoke Pokemon.js:873-875
    return { active: [], best: null, fastest: null };
  }

  // PvPoke Pokemon.js:752-754 (Array.prototype.sort is stable, as in V8)
  active.sort((a, b) => (a.move.energy > b.move.energy ? 1 : b.move.energy > a.move.energy ? -1 : 0));
  // Keep the entry, not the move: the Registeel clause may replace the move object PvPoke mutates in place.
  const fastest = active[0]!;

  // PvPoke Pokemon.js:756-839
  if (active.length > 1) {
    for (let i = 1; i < active.length; i++) {
      // PvPoke Pokemon.js:759-768: same energy, buffing or harder-hitting move goes first
      if (active[i]!.move.energy === active[0]!.move.energy && !active[i]!.move.selfDebuffing) {
        if (active[i]!.move.buffs || active[i]!.damage > active[0]!.damage) {
          rotate(active);
        }
      }

      // PvPoke Pokemon.js:770-776: same energy, more reliable buff goes first
      if (active[i]!.move.energy === active[0]!.move.energy && active[0]!.move.buffs && active[i]!.move.buffs
        && !active[i]!.move.selfDebuffing && active[0]!.move.buffs
        && active[i]!.move.buffs!.chance > active[0]!.move.buffs!.chance) {
        rotate(active);
      }

      // PvPoke Pokemon.js:778-790: the Zap Cannon Registeel clause. PvPoke's rewrite persists from an earlier
      // resetMoves call, but only the equal-energy clauses above could read it first (Focus Blast 75 vs Zap Cannon 80).
      if (active[0]!.move.id === 'FOCUS_BLAST' && active[i]!.move.id === 'ZAP_CANNON') {
        if (active[i]!.dpe - active[0]!.dpe > -0.3) {
          active[0]!.move = asSelfDebuffing(active[0]!.move);
        } else {
          active[0]!.move = withoutBuffs(active[0]!.move);
        }
      }

      // PvPoke Pokemon.js:792-800 skipped: Aegislash shield form (form changes unsupported).

      // PvPoke Pokemon.js:802-811: close energy and DPE, self-buffing move goes first
      if (active[i]!.move.energy - active[0]!.move.energy <= 10 && !active[i]!.move.selfDebuffing) {
        if (active[i]!.move.selfBuffing && active[0]!.dpe - active[i]!.dpe < 0.3) {
          rotate(active);
        }
      }

      // PvPoke Pokemon.js:813-819: cheaper attack-debuffing move yields to a close non-debuffing move
      if (active[i]!.move.energy - active[0]!.move.energy <= 10 && active[0]!.move.selfAttackDebuffing
        && !active[i]!.move.selfDebuffing) {
        rotate(active);
      }

      // PvPoke Pokemon.js:821-827: cheaper unstackable (>50 energy) self-debuffing move yields likewise
      if (active[i]!.move.energy - active[0]!.move.energy <= 10 && active[0]!.move.selfDebuffing
        && active[0]!.move.energy > 50 && !active[i]!.move.selfDebuffing) {
        rotate(active);
      }

      // PvPoke Pokemon.js:829-835: close-energy self-buffing move becomes the bait
      if (active[i]!.move.energy - active[0]!.move.energy <= 5 && active[i]!.move.selfBuffing) {
        rotate(active);
      }
    }
  }

  // PvPoke Pokemon.js:841-842: from here DPE is plain damage / energy, overwriting initializeMove's value
  let best = active[0]!;
  best.dpe = best.damage / best.move.energy;

  // PvPoke Pokemon.js:844-867
  for (let i = 0; i < active.length; i++) {
    const move = active[i]!;
    move.dpe = move.damage / move.move.energy;

    // Use moves that have higher DPE
    if ((move.dpe - best.dpe > 0.03 && move.move.id !== 'SUPER_POWER') || move.dpe - best.dpe > 0.3) {
      if (!best.move.selfBuffing || (best.move.selfBuffing && move.dpe - best.dpe > 0.3)) {
        best = active[i]!;
      }
    }

    // When DPE is close, favor moves with guaranteed buff effects
    if (Math.abs(move.dpe - best.dpe) < 0.03 && best.move.buffs && move.move.buffs
      && move.move.buffs.chance > best.move.buffs.chance && !move.move.selfDebuffing) {
      best = active[i]!;
    }

    // Favor Obstruct over close energy moves
    if (active[i]!.move.id === 'OBSTRUCT') {
      best = active[i]!;
    }
  }

  // PvPoke Pokemon.js:869-872: favor Obstruct over close energy moves
  if (active[0]!.move.id === 'OBSTRUCT' && active[0]!.move.energy - best.move.energy <= 5
    && active[0]!.dpe / best.dpe > 0.2) {
    best = active[0]!;
  }

  return { active: active.map((e) => e.move), best: best.move, fastest: fastest.move };
}
