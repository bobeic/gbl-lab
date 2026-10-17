// tests/combatant.test.ts
import { describe, expect, it } from 'vitest';
import { loadDefaultGameData } from '../src/data/node';
import { GameDataError, StatsError, UnsupportedPokemonError } from '../src/errors';
import { buildCombatant, effectiveStat, formOf, moveDamage, withForm } from '../src/engine/combatant';

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
    expect(() => buildCombatant(gd, { speciesId: 'aegislash_shield', fastMoveId: 'AEGISLASH_CHARGE_PSYCHO_CUT', chargedMoveIds: ['SHADOW_BALL'] }))
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

describe('form-changing Pokémon', () => {
  const morpekoSpec = { speciesId: 'morpeko_full_belly', fastMoveId: 'THUNDER_SHOCK', chargedMoveIds: ['AURA_WHEEL_ELECTRIC', 'PSYCHIC_FANGS'] };
  const mimikyuSpec = { speciesId: 'mimikyu', fastMoveId: 'SHADOW_CLAW', chargedMoveIds: ['SHADOW_SNEAK', 'PLAY_ROUGH'] };

  it('builds Morpeko with both forms and Aura Wheel swapped in the same slot', () => {
    const c = buildCombatant(gd, morpekoSpec);
    expect(c.startFormId).toBe('morpeko_full_belly');
    expect([...c.forms.keys()]).toEqual(['morpeko_full_belly', 'morpeko_hangry']);
    expect(c.forms.get('morpeko_hangry')?.chargedMoves.map((m) => m.id)).toEqual(['AURA_WHEEL_DARK', 'PSYCHIC_FANGS']);
    expect(c.forms.get('morpeko_hangry')?.formChange?.alternativeFormId).toBe('morpeko_full_belly');
    expect(withForm(c, 'morpeko_hangry').chargedMoves[0]?.id).toBe('AURA_WHEEL_DARK');
    expect(withForm(c, 'morpeko_hangry').stats).toEqual(c.stats);
    expect(withForm(c, 'morpeko_full_belly')).toBe(c);
  });

  it('builds Mimikyu with its busted form, which carries -1 Defense and no further change', () => {
    const c = buildCombatant(gd, mimikyuSpec);
    expect([...c.forms.keys()]).toEqual(['mimikyu', 'mimikyu_busted']);
    expect(c.forms.get('mimikyu')?.formChange?.effect).toBe('protect');
    expect(c.forms.get('mimikyu_busted')?.nativeStatBuffs).toEqual([0, -1]);
    expect(c.forms.get('mimikyu_busted')?.formChange?.trigger).toBe('none');
  });

  it('gives an ordinary Pokémon a single form with its species types', () => {
    const c = buildCombatant(gd, { speciesId: 'medicham', fastMoveId: 'COUNTER', chargedMoveIds: ['ICE_PUNCH'] });
    expect([...c.forms.keys()]).toEqual(['medicham']);
    expect(c.types).toEqual(['fighting', 'psychic']);
  });

  it('fails loudly for a form the combatant does not have', () => {
    const c = buildCombatant(gd, mimikyuSpec);
    expect(() => withForm(c, 'morpeko_hangry')).toThrow(new GameDataError('mimikyu has no form morpeko_hangry'));
  });

  it('rejects battle-only forms, naming the form to use', () => {
    expect(() => buildCombatant(gd, { ...morpekoSpec, speciesId: 'morpeko_hangry', chargedMoveIds: ['AURA_WHEEL_DARK'] }))
      .toThrow(new GameDataError('morpeko_hangry is a battle-only form; use morpeko_full_belly'));
    expect(() => buildCombatant(gd, { ...mimikyuSpec, speciesId: 'mimikyu_busted' }))
      .toThrow(new GameDataError('mimikyu_busted is a battle-only form; use mimikyu'));
  });

  it('builds Cramorant with both prey forms', () => {
    const c = buildCombatant(gd, { speciesId: 'cramorant', fastMoveId: 'PECK', chargedMoveIds: ['DIVE', 'FLY'] });
    expect([...c.forms.keys()].sort()).toEqual(['cramorant', 'cramorant_gorging', 'cramorant_gulping']);
    expect(formOf(c, 'cramorant_gulping').gulpMissile?.id).toBe('GULP_MISSILE_ARROKUDA');
    expect(formOf(c, 'cramorant_gorging').gulpMissile?.id).toBe('GULP_MISSILE_PIKACHU');
    expect(formOf(c, 'cramorant').gulpMissile).toBeNull();
  });

  it('still rejects Aegislash, naming its rule', () => {
    expect(() => buildCombatant(gd, { speciesId: 'aegislash_shield', fastMoveId: 'AEGISLASH_CHARGE_PSYCHO_CUT', chargedMoveIds: ['SHADOW_BALL', 'GYRO_BALL'] }))
      .toThrow(/aegislash_shield: form change \(activate_charged/);
  });
});
