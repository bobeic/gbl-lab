import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareOracle } from '../scripts/compare-oracle';

describe('PvPoke oracle acceptance (spec §7.2)', () => {
  const summary = compareOracle();
  const fixture = JSON.parse(readFileSync('tests/fixtures/oracle-gl.json', 'utf8')) as { upstream: string; cases: unknown[] };

  it('compares a non-trivial fixture (100-species round robin at 0/1/2 shields)', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(15000);
    expect(summary.total).toBe(fixture.cases.length);
  });

  it('includes the form changers Mimikyu and Morpeko in the top-100 set', () => {
    const ids = new Set((fixture.cases as { a: { speciesId: string } }[]).map((c) => c.a.speciesId));
    expect(ids.has('mimikyu')).toBe(true);
    expect(ids.has('morpeko_full_belly')).toBe(true);
  });

  it('was generated from the vendored PvPoke commit', () => {
    expect(fixture.upstream).toBe(readFileSync('data/UPSTREAM', 'utf8').trim());
  });

  it('matches PvPoke exactly in every matchup (achieved parity, locked in)', () => {
    expect(summary.exactMatches).toBe(summary.total);
  });

  it('agrees on the winner in at least 98% of matchups', () => {
    expect(summary.winnerAgreement).toBeGreaterThanOrEqual(0.98);
  });

  it('has a median absolute rating difference of at most 25', () => {
    expect(summary.medianAbsRatingDiff).toBeLessThanOrEqual(25);
  });
});
