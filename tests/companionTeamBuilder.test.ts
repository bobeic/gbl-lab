import { describe, expect, it } from 'vitest';
import { metaWeights, recommendTeams, scoreOrder, type Candidate, type Diag } from '../src/companion';

const META = 12;
const LOSE: Diag = [400, 400, 400];

function cand(index: number, dex: number, ratings: Diag[]): Candidate {
  return { index, dex, ratings };
}

/** META ratings, all `fill` except the ones given. */
function ratings(fill: Diag, wins: Record<number, Diag> = {}): Diag[] {
  return Array.from({ length: META }, (_, o) => wins[o] ?? fill);
}

const UNIFORM = { weights: Array<number>(META).fill(1), key: Array.from({ length: META }, (_, o) => o < 10) };

const range = (from: number, to: number, d: Diag): Record<number, Diag> =>
  Object.fromEntries(Array.from({ length: to - from + 1 }, (_, i) => [from + i, d]));

describe('scoreOrder', () => {
  const safe = cand(1, 2, ratings(LOSE));
  const closer = cand(2, 3, ratings(LOSE, range(4, 5, [600, 400, 400])));

  it('scores coverage from role scenarios', () => {
    const lead = cand(0, 1, ratings(LOSE, range(0, 3, [400, 600, 400])));
    const s = scoreOrder([lead, safe, closer], UNIFORM);
    expect(s.covered).toBe(6);
    expect(s.coverage).toBe(50);
    expect(s.roleWins).toEqual([4, 0, 2]);
    expect(s.order).toEqual([0, 1, 2]);
  });

  it('counts consistency only for wins that hold at 0-0 and 2-2', () => {
    const lead = cand(0, 1, ratings(LOSE, { ...range(0, 3, [400, 600, 400]), ...range(0, 1, [600, 600, 600]) }));
    expect(scoreOrder([lead, safe, closer]).consistency).toBeCloseTo((2 / 6) * 100);
  });

  it('consistency is 0 with no wins', () => {
    const s = scoreOrder([cand(0, 1, ratings(LOSE)), safe, cand(2, 3, ratings(LOSE))]);
    expect(s.consistency).toBe(0);
    expect(s.coverage).toBe(0);
  });

  it('safety loses 8 per % of the meta countering the safe switch and 10 per uncovered top-10, floored at 0', () => {
    // Lead covers everything except 7, 8 and 9 (all in the top 10).
    const lead = cand(0, 1, ratings([600, 600, 600], range(7, 9, LOSE)));
    const oneCounter = cand(1, 2, ratings(LOSE, range(11, 11, [400, 250, 400])));
    const s = scoreOrder([lead, oneCounter, cand(2, 3, ratings(LOSE))], UNIFORM);
    expect(s.safeCounters).toBe(1);
    expect(s.keyUncovered).toBe(3);
    expect(s.safety).toBeCloseTo(100 - 8 * (100 / 12) - 30);

    const twoCounters = cand(1, 2, ratings(LOSE, range(10, 11, [400, 250, 400])));
    expect(scoreOrder([lead, twoCounters, cand(2, 3, ratings(LOSE))], UNIFORM).safety).toBe(0);
  });

  it('a counter near the top of the meta costs more safety than one near the bottom', () => {
    const lead = cand(0, 1, ratings([600, 600, 600]));
    const counteredBy = (o: number) => cand(1, 2, ratings(LOSE, { [o]: [400, 250, 400] }));
    const safety = (o: number) => scoreOrder([lead, counteredBy(o), cand(2, 3, ratings(LOSE))]).safety;
    expect(safety(0)).toBeLessThan(safety(11));
  });

  it('score is 0.5 coverage + 0.25 consistency + 0.25 safety', () => {
    const lead = cand(0, 1, ratings(LOSE, { ...range(0, 3, [400, 600, 400]), ...range(0, 1, [600, 600, 600]) }));
    const s = scoreOrder([lead, safe, closer]);
    expect(s.score).toBeCloseTo(0.5 * s.coverage + 0.25 * s.consistency + 0.25 * s.safety);
  });
});

describe('meta weighting', () => {
  const lead = cand(0, 1, ratings(LOSE, range(0, 0, [400, 600, 400])));
  const tail = cand(0, 1, ratings(LOSE, range(11, 11, [400, 600, 400])));
  const rest = [cand(1, 2, ratings(LOSE)), cand(2, 3, ratings(LOSE))] as const;

  it('weights coverage toward the top of the meta', () => {
    expect(scoreOrder([lead, ...rest]).coverage).toBeGreaterThan(scoreOrder([tail, ...rest]).coverage);
    const w = metaWeights(META).weights;
    expect(scoreOrder([lead, ...rest]).coverage).toBeCloseTo((w[0]! / w.reduce((a, b) => a + b)) * 100);
  });

  it('boosts priorities and counts them as key threats', () => {
    const w = metaWeights(META, [11]);
    expect(w.weights[11]).toBeCloseTo(3 * metaWeights(META).weights[11]!);
    expect(w.key[11]).toBe(true);
    expect(w.key[10]).toBe(false);
    // Neither covers 10 or 11; marking 11 a priority costs safety.
    expect(scoreOrder([lead, ...rest], w).keyUncovered).toBe(scoreOrder([lead, ...rest]).keyUncovered + 1);
  });

  it('a priority can flip which team wins', () => {
    // a covers only #2, b covers only #12.
    const a = cand(0, 1, ratings(LOSE, range(1, 1, [600, 600, 600])));
    const b = cand(3, 4, ratings(LOSE, range(11, 11, [600, 600, 600])));
    const pool = [a, ...rest, b];
    const best = (pr: number[]) => recommendTeams(pool, [1, 2], metaWeights(META, pr))[0]!.order;
    expect(best([])).toContain(0);
    expect(best([11])).toContain(3);
  });
});

describe('recommendTeams', () => {
  const plain = (index: number, dex = index + 1) => cand(index, dex, ratings(LOSE));

  it('picks the best of the 6 orders', () => {
    const zeroZeroOnly = cand(0, 1, ratings([600, 400, 400]));
    const [best] = recommendTeams([zeroZeroOnly, plain(1), plain(2)], []);
    expect(best!.order[2]).toBe(0);
  });

  it('never pairs the same Pokédex number', () => {
    const teams = recommendTeams([plain(0, 308), plain(1, 184), plain(2, 308), plain(3, 379)], []);
    expect(teams.length).toBe(2);
    for (const t of teams) expect(t.order.includes(0) && t.order.includes(2)).toBe(false);
  });

  it('every team contains all pins', () => {
    const four = [0, 1, 2, 3].map((i) => plain(i));
    const one = recommendTeams(four, [2]);
    expect(one.length).toBe(3);
    for (const t of one) expect(t.order).toContain(2);
    const two = recommendTeams(four, [0, 3]);
    expect(two.length).toBe(2);
    for (const t of two) expect(t.order).toEqual(expect.arrayContaining([0, 3]));
  });

  it('returns no teams when pins clash', () => {
    expect(recommendTeams([plain(0, 308), plain(1, 184), plain(2, 308), plain(3, 379)], [0, 2])).toEqual([]);
  });

  it('ranks by score, ties by roster order, top 10 only', () => {
    const seven = [0, 1, 2, 3, 4, 5, 6].map((i) => plain(i));
    const teams = recommendTeams(seven, []);
    expect(teams.length).toBe(10);
    expect([...teams[0]!.order].sort()).toEqual([0, 1, 2]);
    expect([...teams[1]!.order].sort()).toEqual([0, 1, 3]);

    const better = cand(6, 7, ratings([600, 600, 600]));
    expect(recommendTeams([...seven.slice(0, 6), better], [])[0]!.order).toContain(6);
  });

  it('lists threats worst first', () => {
    const beatsAll = (low: Record<number, Diag>) => ratings([600, 600, 600], low);
    const a = cand(0, 1, beatsAll({ 3: [400, 450, 400], 8: [400, 100, 400] }));
    const b = cand(1, 2, ratings([0, 0, 0]));
    const c = cand(2, 3, ratings([0, 0, 0]));
    expect(scoreOrder([a, b, c]).threats).toEqual([8, 3]);
  });
});
