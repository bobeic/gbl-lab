import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareOracle } from '../scripts/compare-oracle';

describe('PvPoke oracle acceptance (spec §7.2)', () => {
  const summary = compareOracle();
  const fixtureCases = (JSON.parse(readFileSync('tests/fixtures/oracle-gl.json', 'utf8')) as { cases: unknown[] }).cases.length;

  it('compares a non-trivial fixture (100-species round robin at 0/1/2 shields)', () => {
    expect(fixtureCases).toBeGreaterThan(0);
    expect(summary.total).toBe(fixtureCases);
  });

  it('agrees on the winner in at least 98% of matchups', () => {
    expect(summary.winnerAgreement).toBeGreaterThanOrEqual(0.98);
  });

  it('has a median absolute rating difference of at most 25', () => {
    expect(summary.medianAbsRatingDiff).toBeLessThanOrEqual(25);
  });
});
