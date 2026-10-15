import { describe, expect, it } from 'vitest';
import { effectiveness } from '../src/data/typeChart';

describe('effectiveness', () => {
  it('uses PvPoke float32 constants', () => {
    expect(effectiveness('fighting', ['steel'])).toBe(1.60000002384185791015625);
    expect(effectiveness('fighting', ['fairy'])).toBe(0.625);
    expect(effectiveness('ghost', ['normal'])).toBe(0.390625);
  });

  it('multiplies across dual types in defender type order', () => {
    expect(effectiveness('fighting', ['water', 'fairy'])).toBe(0.625);
    expect(effectiveness('ground', ['steel', 'rock'])).toBe(1.60000002384185791015625 * 1.60000002384185791015625);
    expect(effectiveness('electric', ['water', 'ground'])).toBe(1.60000002384185791015625 * 0.390625);
  });

  it('is neutral when no interaction', () => {
    expect(effectiveness('normal', ['water'])).toBe(1);
  });
});
