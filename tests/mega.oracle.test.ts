import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareCases, type OracleCase } from '../scripts/compare-oracle';

describe('megas, super megas included, match the PvPoke oracle', () => {
  const fixture = JSON.parse(readFileSync('tests/fixtures/mega-oracle.json', 'utf8')) as { upstream: string; cases: OracleCase[] };

  it('covers every Mega Halloween Cup mega, including Mega Sableye and super mega Greninja, at all nine shield pairings', () => {
    const ids = new Set(fixture.cases.map((c) => c.a.speciesId));
    expect(ids.has('sableye_mega')).toBe(true);
    expect(ids.has('greninja_mega')).toBe(true);
    expect(fixture.cases.length).toBe(ids.size * 50 * 9);
  });

  it('was generated from the vendored PvPoke commit', () => {
    expect(fixture.upstream).toBe(readFileSync('data/UPSTREAM', 'utf8').trim());
  });

  it('matches PvPoke exactly in every case', () => {
    const summary = compareCases(fixture.cases);
    expect(summary.exactMatches).toBe(summary.total);
  });
});

describe('LAIC 2027 Cup megas and primals match the PvPoke oracle', () => {
  const fixture = JSON.parse(readFileSync('tests/fixtures/laic-mega-oracle.json', 'utf8')) as { upstream: string; cases: OracleCase[] };

  it('covers every LAIC 2027 Cup mega, including super megas and primals, at all nine shield pairings', () => {
    const ids = new Set(fixture.cases.map((c) => c.a.speciesId));
    for (const id of ['dragonite_mega', 'mewtwo_mega_x', 'kyogre_primal']) expect(ids.has(id)).toBe(true);
    expect(fixture.cases.length).toBe(ids.size * 50 * 9);
  });

  it('was generated from the vendored PvPoke commit', () => {
    expect(fixture.upstream).toBe(readFileSync('data/UPSTREAM', 'utf8').trim());
  });

  it('matches PvPoke exactly in every case', () => {
    const summary = compareCases(fixture.cases);
    expect(summary.exactMatches).toBe(summary.total);
  });
});
