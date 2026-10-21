import { describe, expect, it } from 'vitest';
import { normalizeName, searchSpecies } from '../src/companion';
import { testAppData } from './companionFixture';

const app = testAppData();
const ids = (q: string, limit?: number): string[] => searchSpecies(app.ranked, q, limit).map((r) => r.speciesId);

describe('normalizeName', () => {
  it('lowercases, strips diacritics and collapses punctuation', () => {
    expect(normalizeName("  Farfetch'd (Galarian) ")).toBe('farfetch d galarian');
    expect(normalizeName('Flabébé')).toBe('flabebe');
  });
});

describe('searchSpecies', () => {
  it('matches a name prefix, best ranked first', () => {
    expect(ids('mel')[0]).toBe('melmetal');
  });

  it.each(['mr. m', 'MR M'])('ignores case and punctuation (%s)', (q) => {
    const r = ids(q);
    expect(r.indexOf('mr_mime')).toBeGreaterThanOrEqual(0);
    expect(r.indexOf('mr_mime')).toBeLessThan(r.indexOf('mr_mime_galarian'));
  });

  it('returns results in rank order', () => {
    const r = ids('farfetch');
    expect(r.indexOf('farfetchd_galarian')).toBeGreaterThanOrEqual(0);
    expect(r.indexOf('farfetchd_galarian')).toBeLessThan(r.indexOf('farfetchd'));
  });

  it('ignores diacritics in the query', () => {
    expect(ids('flabébé')).toContain('flabebe');
  });

  it('matches every query word as a prefix of some name word', () => {
    expect(ids('ninetales sh')[0]).toBe('ninetales_shadow');
  });

  it.each(['', '  ', '...'])('returns nothing for an empty query (%j)', (q) => {
    expect(ids(q)).toEqual([]);
  });

  it('respects the limit', () => {
    expect(ids('a')).toHaveLength(8);
    expect(ids('a', 3)).toHaveLength(3);
  });
});
