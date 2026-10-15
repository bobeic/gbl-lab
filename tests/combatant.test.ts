// tests/combatant.test.ts
import { describe, expect, it } from 'vitest';
import { loadDefaultGameData } from '../src/data';
import { GameDataError, StatsError, UnsupportedPokemonError } from '../src/errors';
import { buildCombatant, effectiveStat, moveDamage } from '../src/engine/combatant';

const gd = loadDefaultGameData();

describe('buildCombatant', () => {
  it('rejects the same charged move equipped twice', () => {
    expect(() => buildCombatant(gd, { speciesId: 'medicham', fastMoveId: 'COUNTER', chargedMoveIds: ['ICE_PUNCH', 'ICE_PUNCH'] })).toThrow(GameDataError);
  });

  it('defaults to PvPoke default IVs and level for Great League', () => {
    const c = buildCombatant(gd, { speciesId: 'medicham', fastMoveId: 'COUNTER', chargedMoveIds: ['ICE_PUNCH', 'PSYCHIC'] });
    expect(c.ivs).toEqual({ atk: 7, def: 15, hp: 14 });
    expect(c.level).toBe(49);
    expect(c.cp).toBe(1500);
    expect(c.stats.hp).toBe(141);
    expect(c.settings).toEqual({ baitShields: 1, optimizeMoveTiming: true, farmEnergy: false });
  });

  it('finds the best level under the cap for custom IVs', () => {
    const c = buildCombatant(gd, { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM'], ivs: { atk: 4, def: 15, hp: 13 } });
    expect(c.level).toBe(43);
    expect(c.chargedMoves).toHaveLength(1);
  });

  it('applies shadow multipliers in effective stats only', () => {
    const c = buildCombatant(gd, { speciesId: 'registeel_shadow', fastMoveId: 'LOCK_ON', chargedMoveIds: ['FOCUS_BLAST'] });
    expect(c.shadow).toBe(true);
    expect(effectiveStat(c, 'atk', 0, 4)).toBe(c.stats.atk * 1.2);
    expect(effectiveStat(c, 'def', 0, 4)).toBe(c.stats.def * 0.83333331);
  });

  it('accepts elite moves and rejects moves outside the pool', () => {
    expect(() => buildCombatant(gd, { speciesId: 'melmetal', fastMoveId: 'THUNDER_SHOCK', chargedMoveIds: ['DOUBLE_IRON_BASH'] })).not.toThrow();
    expect(() => buildCombatant(gd, { speciesId: 'medicham', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_PUNCH'] }))
      .toThrow(new GameDataError('medicham cannot learn fast move BUBBLE'));
  });

  it('rejects a move whose kind does not match its slot', () => {
    expect(() => buildCombatant(gd, { speciesId: 'ditto', fastMoveId: 'TRANSFORM', chargedMoveIds: ['STRUGGLE'] }))
      .toThrow(new GameDataError('ditto: fast move TRANSFORM is not a fast move'));
  });

  it('requires one or two charged moves', () => {
    expect(() => buildCombatant(gd, { speciesId: 'medicham', fastMoveId: 'COUNTER', chargedMoveIds: [] })).toThrow(GameDataError);
  });

  it('rejects unknown species, form changers and megas', () => {
    expect(() => buildCombatant(gd, { speciesId: 'nope', fastMoveId: 'X', chargedMoveIds: ['Y'] })).toThrow(GameDataError);
    expect(() => buildCombatant(gd, { speciesId: 'mimikyu', fastMoveId: 'SHADOW_CLAW', chargedMoveIds: ['PLAY_ROUGH'] }))
      .toThrow(UnsupportedPokemonError);
    expect(() => buildCombatant(gd, { speciesId: 'medicham_mega', fastMoveId: 'COUNTER', chargedMoveIds: ['ICE_PUNCH'] }))
      .toThrow(UnsupportedPokemonError);
  });

  it('rejects IVs that cannot fit under the cap and levels above max', () => {
    expect(() => buildCombatant(gd, { speciesId: 'medicham', fastMoveId: 'COUNTER', chargedMoveIds: ['ICE_PUNCH'], ivs: { atk: 15, def: 15, hp: 15 }, cpCap: 10 }))
      .toThrow(StatsError);
    expect(() => buildCombatant(gd, { speciesId: 'medicham', fastMoveId: 'COUNTER', chargedMoveIds: ['ICE_PUNCH'], ivs: { atk: 0, def: 0, hp: 0 }, level: 52 }))
      .toThrow(StatsError);
  });
});

describe('moveDamage', () => {
  it('reproduces PvPoke hits including STAB and effectiveness', () => {
    const med = buildCombatant(gd, { speciesId: 'medicham', fastMoveId: 'COUNTER', chargedMoveIds: ['ICE_PUNCH'] });
    const azu = buildCombatant(gd, { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM'] });
    expect(moveDamage(med, 0, azu, 0, med.fastMove, 4)).toBe(4);
    expect(moveDamage(azu, 0, med, 0, azu.fastMove, 4)).toBe(5);
    expect(moveDamage(med, 0, azu, 0, med.chargedMoves[0]!, 4)).toBe(20);
  });
});
