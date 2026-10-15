import { describe, expect, it } from 'vitest';
import { effectiveness } from '../src/data/typeChart';
import { buffMultiplier, calcDamage, clampStage } from '../src/engine/damage';
import { STAB_MULTIPLIER } from '../src/engine/constants';

const MEDICHAM = { atk: 106.91840362548825, def: 139.4951047301292 };
const AZUMARILL = { atk: 93.41479969024648, def: 134.48509955406175 };

describe('calcDamage reproduces PvPoke hits', () => {
  it('Counter: Medicham -> Azumarill = 4', () => {
    expect(calcDamage(8, STAB_MULTIPLIER, MEDICHAM.atk, AZUMARILL.def, effectiveness('fighting', ['water', 'fairy']))).toBe(4);
  });
  it('Bubble: Azumarill -> Medicham = 5', () => {
    expect(calcDamage(8, STAB_MULTIPLIER, AZUMARILL.atk, MEDICHAM.def, effectiveness('water', ['fighting', 'psychic']))).toBe(5);
  });
  it('Counter mirror = 3', () => {
    expect(calcDamage(8, STAB_MULTIPLIER, MEDICHAM.atk, MEDICHAM.def, effectiveness('fighting', ['fighting', 'psychic']))).toBe(3);
  });
  it('Ice Punch: Medicham -> Azumarill = 20', () => {
    expect(calcDamage(60, 1, MEDICHAM.atk, AZUMARILL.def, effectiveness('ice', ['water', 'fairy']))).toBe(20);
  });
});

describe('buff math', () => {
  it('uses (d+n)/d for boosts and d/(d-n) for drops', () => {
    expect(buffMultiplier(0, 4)).toBe(1);
    expect(buffMultiplier(1, 4)).toBe(1.25);
    expect(buffMultiplier(4, 4)).toBe(2);
    expect(buffMultiplier(-1, 4)).toBe(0.8);
    expect(buffMultiplier(-4, 4)).toBe(0.5);
  });
  it('clamps stages to +-max', () => {
    expect(clampStage(6, 4)).toBe(4);
    expect(clampStage(-5, 4)).toBe(-4);
    expect(clampStage(2, 4)).toBe(2);
  });
});
