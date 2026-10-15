import type { Species } from '../data/types';
import { StatsError } from '../errors';
import { cpmForLevel } from './cpm';
import { bestLevelUnderCap, computeCp, type Ivs } from './stats';

/** One ranked IV combination; stats are PvPoke's IV-table stats (HP floored, never clamped to 10). */
export interface IvRankEntry {
  readonly rank: number;
  readonly ivs: Ivs;
  readonly level: number;
  readonly cp: number;
  readonly atk: number;
  readonly def: number;
  readonly hp: number;
  readonly statProduct: number;
  readonly percentOfBest: number;
}

export interface IvRankOptions {
  readonly cap?: number;
  readonly maxLevel?: number;
  /**
   * Minimum IV per stat: 0 wild, 1 good friend, 2 great, 3 ultra, 4 best, 5 weather, 10 raid/research, 12 lucky.
   * When given it is used as-is; when omitted PvPoke's species rule applies (see defaultIvFloor).
   */
  readonly ivFloor?: number;
  /** Equipped charged moves; only consulted by the default floor rule (Return forces floor 2). */
  readonly chargedMoveIds?: readonly string[];
}

/** Return PvPoke's default IV floor for a species and equipped charged moves (Pokemon.js generateIVCombinations). */
export function defaultIvFloor(species: Species, chargedMoveIds: readonly string[] = []): number {
  // Later rules override earlier ones, in PvPoke's order.
  const legendary = species.tags.includes('legendary') || species.tags.includes('ultrabeast');
  let floor = 0;
  if (legendary && !species.tags.includes('wildlegendary')) floor = 1;
  if (legendary && species.tags.includes('shadow')) floor = 6;
  if (species.tags.includes('untradeable')) floor = 10;
  if (chargedMoveIds.includes('RETURN')) floor = 2;
  return floor;
}

/** Rank every IV combination of a species by stat product at its best level under the cap, in PvPoke's order. */
export function rankIvs(species: Species, opts: IvRankOptions = {}): IvRankEntry[] {
  const cap = opts.cap ?? 1500;
  const maxLevel = opts.maxLevel ?? 50;
  const floor = opts.ivFloor ?? defaultIvFloor(species, opts.chargedMoveIds);
  if (!Number.isInteger(floor) || floor < 0 || floor > 15) throw new StatsError(`ivFloor must be 0-15, got ${floor}`);
  // PvPoke ignores the species level floor for Little Cup (cap <= 500).
  const minLevel = cap > 500 ? species.levelFloor : 1;

  // PvPoke's iteration order (hp, then def, then atk, each 15 down to the floor) decides ties under its stable sort.
  const rows: Omit<IvRankEntry, 'rank' | 'percentOfBest'>[] = [];
  for (let hpIv = 15; hpIv >= floor; hpIv--) {
    for (let defIv = 15; defIv >= floor; defIv--) {
      for (let atkIv = 15; atkIv >= floor; atkIv--) {
        const ivs = { atk: atkIv, def: defIv, hp: hpIv };
        const level = bestLevelUnderCap(species.base, ivs, cap, maxLevel, minLevel);
        if (level === null) continue;
        const cpm = cpmForLevel(level);
        const atk = cpm * (species.base.atk + atkIv);
        const def = cpm * (species.base.def + defIv);
        // PvPoke's IV table floors HP without the battle rules' minimum of 10 or Shedinja's fixed 10.
        const hp = Math.floor(cpm * (species.base.hp + hpIv));
        // Multiplication order hp*atk*def matches PvPoke; floating-point rounding decides near-ties.
        rows.push({ ivs, level, cp: computeCp(species.base, ivs, cpm), atk, def, hp, statProduct: hp * atk * def });
      }
    }
  }
  if (rows.length === 0) {
    throw new StatsError(`${species.id}: no IV combination with floor ${floor} fits under ${cap} CP between levels ${minLevel} and ${maxLevel}`);
  }
  rows.sort((a, b) => b.statProduct - a.statProduct);
  const best = rows[0]!.statProduct;
  return rows.map((r, i) => ({ ...r, rank: i + 1, percentOfBest: Math.round((r.statProduct / best) * 10000) / 100 }));
}
