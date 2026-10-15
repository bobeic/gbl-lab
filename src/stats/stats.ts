import type { Species } from '../data/types';
import { StatsError } from '../errors';
import { cpmForLevel } from './cpm';

export interface Ivs {
  readonly atk: number;
  readonly def: number;
  readonly hp: number;
}

export interface ComputedStats {
  readonly atk: number;
  readonly def: number;
  readonly hp: number;
  readonly cp: number;
  readonly cpm: number;
}

const SHEDINJA_DEX = 292;

function assertIvs(ivs: Ivs): void {
  for (const value of [ivs.atk, ivs.def, ivs.hp]) {
    if (!Number.isInteger(value) || value < 0 || value > 15) {
      throw new StatsError(`IVs must be integers 0-15, got ${ivs.atk}/${ivs.def}/${ivs.hp}`);
    }
  }
}

/** Compute CP exactly as PvPoke does. */
export function computeCp(base: Species['base'], ivs: Ivs, cpm: number): number {
  return Math.floor(((base.atk + ivs.atk) * Math.pow(base.def + ivs.def, 0.5) * Math.pow(base.hp + ivs.hp, 0.5) * Math.pow(cpm, 2)) / 10);
}

/** Compute battle stats (unrounded atk/def, floored HP) and CP at a level. */
export function computeStats(base: Species['base'], ivs: Ivs, level: number, dex: number): ComputedStats {
  assertIvs(ivs);
  const cpm = cpmForLevel(level);
  const hp = dex === SHEDINJA_DEX ? 10 : Math.max(Math.floor(cpm * (base.hp + ivs.hp)), 10);
  return {
    atk: cpm * (base.atk + ivs.atk),
    def: cpm * (base.def + ivs.def),
    hp,
    cp: Math.max(computeCp(base, ivs, cpm), 10),
    cpm,
  };
}

/** Return the highest half-level up to maxLevel whose CP is at or under the cap, or null if none. */
export function bestLevelUnderCap(base: Species['base'], ivs: Ivs, cap: number, maxLevel: number): number | null {
  assertIvs(ivs);
  for (let level = maxLevel; level >= 1; level -= 0.5) {
    if (computeCp(base, ivs, cpmForLevel(level)) <= cap) return level;
  }
  return null;
}
