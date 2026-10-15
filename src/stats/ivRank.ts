import type { Species } from '../data/types';
import { StatsError } from '../errors';
import { bestLevelUnderCap, computeStats, type Ivs } from './stats';

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
  /** Minimum IV per stat: 0 wild, 1 good friend, 2 great, 3 ultra, 4 best, 5 weather, 10 raid/research, 12 lucky. */
  readonly ivFloor?: number;
}

/** Rank every IV combination of a species by stat product at its best level under the cap. */
export function rankIvs(species: Species, opts: IvRankOptions = {}): IvRankEntry[] {
  const cap = opts.cap ?? 1500;
  const maxLevel = opts.maxLevel ?? 50;
  const floor = opts.ivFloor ?? 0;
  if (!Number.isInteger(floor) || floor < 0 || floor > 15) throw new StatsError(`ivFloor must be 0-15, got ${floor}`);

  const rows: Omit<IvRankEntry, 'rank' | 'percentOfBest'>[] = [];
  for (let atk = floor; atk <= 15; atk++) {
    for (let def = floor; def <= 15; def++) {
      for (let hp = floor; hp <= 15; hp++) {
        const ivs = { atk, def, hp };
        const level = bestLevelUnderCap(species.base, ivs, cap, maxLevel);
        if (level === null) continue;
        const s = computeStats(species.base, ivs, level, species.dex);
        rows.push({ ivs, level, cp: s.cp, atk: s.atk, def: s.def, hp: s.hp, statProduct: s.atk * s.def * s.hp });
      }
    }
  }
  rows.sort((a, b) => b.statProduct - a.statProduct);
  const best = rows[0]?.statProduct ?? 0;
  return rows.map((r, i) => ({ ...r, rank: i + 1, percentOfBest: best === 0 ? 0 : Math.round((r.statProduct / best) * 10000) / 100 }));
}
