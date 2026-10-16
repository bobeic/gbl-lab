import { describe, expect, it } from 'vitest';
import { countSequence, formatCounts } from '../src/companion';
import { loadDefaultGameData } from '../src/data/node';

const gd = loadDefaultGameData();

function counts(fastId: string, chargedId: string): string {
  const fast = gd.moves.get(fastId);
  const charged = gd.moves.get(chargedId);
  if (fast?.kind !== 'fast' || charged?.kind !== 'charged') throw new Error(`bad moves ${fastId} ${chargedId}`);
  return formatCounts(countSequence(fast.energyGain, charged.energy));
}

describe('countSequence', () => {
  it.each([
    ['PSYCHO_CUT', 'ICE_PUNCH', '5-4-5'],
    ['PSYCHO_CUT', 'DYNAMIC_PUNCH', '5-5-5'],
    ['THUNDER_SHOCK', 'DOUBLE_IRON_BASH', '4-4-4'],
    ['THUNDER_SHOCK', 'DYNAMIC_PUNCH', '5-5-5'],
    ['INFESTATION', 'WATER_PULSE', '5-4-4'],
    ['INFESTATION', 'MIRROR_COAT', '4-4-4'],
    ['BUBBLE', 'ICE_BEAM', '5-5-5'],
    ['BUBBLE', 'PLAY_ROUGH', '6-5-6'],
    ['SHADOW_CLAW', 'SHADOW_SNEAK', '7-6-6'],
    ['SHADOW_CLAW', 'PLAY_ROUGH', '8-7-8'],
  ])('%s -> %s is %s', (fast, charged, expected) => {
    expect(counts(fast, charged)).toBe(expected);
  });

  it('caps banked energy at 100', () => {
    expect(countSequence(20, 100)).toEqual([5, 5, 5]);
  });

  it('honours the number of throws', () => {
    expect(countSequence(9, 40, 1)).toEqual([5]);
  });

  it.each([
    [0, 40],
    [9, 0],
    [9, 101],
  ])('rejects energyGain %i / cost %i', (gain, cost) => {
    expect(() => countSequence(gain, cost)).toThrow(RangeError);
  });
});
