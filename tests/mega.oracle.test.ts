import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareCases, type OracleCase } from '../scripts/compare-oracle';

describe('megas, super megas included, match the PvPoke oracle', () => {
  const fixture = JSON.parse(readFileSync('tests/fixtures/mega-oracle.json', 'utf8')) as {
    upstream: string; halloweenMega: OracleCase[]; megaGreat: OracleCase[];
  };
  const megaIds = (cases: readonly OracleCase[]) => new Set(cases.map((c) => c.a.speciesId));

  it('covers every Mega Halloween Cup mega, including super megas Sableye and Greninja, at all nine shield pairings', () => {
    const ids = megaIds(fixture.halloweenMega);
    expect(ids.has('sableye_mega')).toBe(true);
    expect(ids.has('greninja_mega')).toBe(true);
    expect(fixture.halloweenMega.length).toBe(ids.size * 50 * 9);
  });

  it("covers Mega Great League's other megas against its own top 50, at all nine shield pairings", () => {
    const ids = megaIds(fixture.megaGreat);
    const halloween = megaIds(fixture.halloweenMega);
    expect([...ids].some((id) => halloween.has(id))).toBe(false);
    expect(ids.has('malamar_mega')).toBe(false);
    expect(ids.has('lopunny_mega')).toBe(true);
    expect(fixture.megaGreat.length).toBe(ids.size * 50 * 9);
  });

  it('was generated from the vendored PvPoke commit', () => {
    expect(fixture.upstream).toBe(readFileSync('data/UPSTREAM', 'utf8').trim());
  });

  it('matches PvPoke exactly in every case', () => {
    const summary = compareCases([...fixture.halloweenMega, ...fixture.megaGreat]);
    expect(summary.exactMatches).toBe(summary.total);
  });
});
