import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareCases, type OracleCase } from '../scripts/compare-oracle';

describe('form changes match the PvPoke oracle (form-changes spec §6.1)', () => {
  const fixture = JSON.parse(readFileSync('tests/fixtures/form-change-oracle.json', 'utf8')) as {
    upstream: string; corrected: OracleCase[]; unmodified: OracleCase[];
  };

  it('covers Mimikyu, Morpeko and Cramorant against the top 100 at all nine shield pairings', () => {
    expect(fixture.corrected.length).toBe(3 * 100 * 9);
    expect(fixture.unmodified.length).toBe(2 * 99 * 9);
  });

  it('was generated from the vendored PvPoke commit', () => {
    expect(fixture.upstream).toBe(readFileSync('data/UPSTREAM', 'utf8').trim());
  });

  it('matches corrected PvPoke exactly in every case', () => {
    const summary = compareCases(fixture.corrected);
    expect(summary.exactMatches).toBe(summary.total);
  });

  it('matches unmodified PvPoke exactly for Mimikyu and Cramorant, so the corrections touch only Morpeko', () => {
    const summary = compareCases(fixture.unmodified);
    expect(summary.exactMatches).toBe(summary.total);
  });
});
