import { PVP_BONUS } from './constants';

/** Return the stat multiplier for a buff stage, matching PvPoke Pokemon.getStatBuffMultiplier. */
export function buffMultiplier(stage: number, divisor: number): number {
  return stage > 0 ? (divisor + stage) / divisor : divisor / (divisor - stage);
}

/** Clamp a buff stage to the range [-max, max]. */
export function clampStage(stage: number, max: number): number {
  return Math.max(-max, Math.min(max, stage));
}

/** Compute the damage of one hit using PvPoke's damage formula. */
export function calcDamage(power: number, stab: number, attack: number, defense: number, eff: number): number {
  // Operand order mirrors PvPoke DamageCalculator.damage so float rounding matches bit-for-bit.
  return Math.floor(power * stab * (attack / defense) * eff * 0.5 * PVP_BONUS) + 1;
}
