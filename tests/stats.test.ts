import { describe, expect, it } from 'vitest';
import { loadDefaultGameData } from '../src/data/node';
import { StatsError } from '../src/errors';
import { cpmForLevel } from '../src/stats/cpm';
import { bestLevelUnderCap, computeStats } from '../src/stats/stats';

const gd = loadDefaultGameData();
const sp = (id: string) => gd.species.get(id)!;

describe('cpm', () => {
  it('indexes half levels', () => {
    expect(cpmForLevel(1)).toBe(0.0939999967813491);
    expect(cpmForLevel(40)).toBe(0.790300011634826);
    expect(() => cpmForLevel(40.25)).toThrow(StatsError);
    expect(() => cpmForLevel(56)).toThrow(StatsError);
  });
});

describe('computeStats matches PvPoke', () => {
  it('Medicham 7/15/14 L49', () => {
    const s = computeStats(sp('medicham').base, { atk: 7, def: 15, hp: 14 }, 49, 308);
    expect(s).toMatchObject({ cp: 1500, hp: 141, atk: 106.91840362548825, def: 139.4951047301292 });
  });
  it('Azumarill 4/15/13 L43', () => {
    const s = computeStats(sp('azumarill').base, { atk: 4, def: 15, hp: 13 }, 43, 184);
    expect(s).toMatchObject({ cp: 1499, hp: 191, atk: 93.41479969024648, def: 134.48509955406175 });
  });
  it('Melmetal 4/10/14 L15.5', () => {
    const s = computeStats(sp('melmetal').base, { atk: 4, def: 10, hp: 14 }, 15.5, 809);
    expect(s).toMatchObject({ cp: 1500, hp: 146, atk: 120.96677701740566, def: 105.1885017542658 });
  });
  it('rejects IVs outside 0-15', () => {
    expect(() => computeStats(sp('medicham').base, { atk: 16, def: 0, hp: 0 }, 20, 308)).toThrow(StatsError);
  });
});

describe('bestLevelUnderCap', () => {
  it('finds the highest half-level at or under the cap', () => {
    expect(bestLevelUnderCap(sp('medicham').base, { atk: 7, def: 15, hp: 14 }, 1500, 50)).toBe(49);
    expect(bestLevelUnderCap(sp('registeel').base, { atk: 8, def: 15, hp: 14 }, 1500, 50)).toBe(22.5);
  });
  it('respects maxLevel when the cap is never reached', () => {
    expect(bestLevelUnderCap(sp('medicham').base, { atk: 0, def: 0, hp: 0 }, 1500, 40)).toBe(40);
  });
  it('returns null when even level 1 exceeds the cap', () => {
    expect(bestLevelUnderCap(sp('mewtwo').base, { atk: 15, def: 15, hp: 15 }, 10, 50)).toBeNull();
  });
});
