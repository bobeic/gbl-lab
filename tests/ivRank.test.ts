import { describe, expect, it } from 'vitest';
import { loadDefaultGameData } from '../src/data';
import { rankIvs } from '../src/stats/ivRank';

const gd = loadDefaultGameData();

describe('rankIvs', () => {
  const ranks = rankIvs(gd.species.get('medicham')!);

  it('covers all 4096 combinations for a species that fits the cap', () => {
    expect(ranks).toHaveLength(4096);
  });

  it('sorts by stat product descending with 1-based ranks', () => {
    expect(ranks[0]!.rank).toBe(1);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i - 1]!.statProduct).toBeGreaterThanOrEqual(ranks[i]!.statProduct);
    }
    expect(ranks[0]!.percentOfBest).toBe(100);
  });

  it('never exceeds the cap', () => {
    expect(ranks.every((r) => r.cp <= 1500)).toBe(true);
  });

  it('respects the IV floor', () => {
    const lucky = rankIvs(gd.species.get('medicham')!, { ivFloor: 12 });
    expect(lucky).toHaveLength(64);
    expect(lucky.every((r) => r.ivs.atk >= 12 && r.ivs.def >= 12 && r.ivs.hp >= 12)).toBe(true);
  });

  it('matches the stat product PvPoke publishes for its default Melmetal', () => {
    const entry = rankIvs(gd.species.get('melmetal')!).find((r) => r.ivs.atk === 4 && r.ivs.def === 10 && r.ivs.hp === 14)!;
    // rankings-1500.json lists stats.product 1858 (= atk*def*hp / 1000, rounded)
    expect(Math.round(entry.statProduct / 1000)).toBe(1858);
  });
});
