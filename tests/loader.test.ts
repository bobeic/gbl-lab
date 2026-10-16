import { describe, expect, it } from 'vitest';
import { GameDataError } from '../src/errors';
import { loadGameData } from '../src/data';
import { loadDefaultGameData } from '../src/data/node';

const minimal = (): Record<string, unknown> => ({
  settings: { maxBuffStages: 4, buffDivisor: 4 },
  pokemon: [
    {
      dex: 308, speciesId: 'medicham', speciesName: 'Medicham',
      baseStats: { atk: 121, def: 152, hp: 155 }, types: ['fighting', 'psychic'],
      fastMoves: ['COUNTER'], chargedMoves: ['POWER_UP_PUNCH'],
      defaultIVs: { cp1500: [49, 7, 15, 14] },
    },
  ],
  moves: [
    { moveId: 'COUNTER', name: 'Counter', type: 'fighting', power: 8, energy: 0, energyGain: 6, cooldown: 1000, turns: 2 },
    {
      moveId: 'POWER_UP_PUNCH', name: 'Power-Up Punch', type: 'fighting', power: 20, energy: 35, energyGain: 0,
      cooldown: 500, turns: 1, buffs: [1, 0], buffTarget: 'self', buffApplyChance: '1',
    },
  ],
});

describe('loadGameData', () => {
  it('parses species and moves into typed objects', () => {
    const gd = loadGameData(minimal());
    const medicham = gd.species.get('medicham');
    expect(medicham?.types).toEqual(['fighting', 'psychic']);
    expect(medicham?.defaultIvsGreat).toEqual({ level: 49, atk: 7, def: 15, hp: 14 });
    const counter = gd.moves.get('COUNTER');
    expect(counter).toMatchObject({ kind: 'fast', energyGain: 6, turns: 2, cooldownMs: 1000 });
    const pup = gd.moves.get('POWER_UP_PUNCH');
    expect(pup).toMatchObject({ kind: 'charged', energy: 35, selfBuffing: true, selfDebuffing: false });
    expect(pup?.buffs).toEqual({ stages: [1, 0], target: 'self', chance: 1 });
  });

  it('drops the "none" type placeholder', () => {
    const raw = minimal();
    (raw.pokemon as Record<string, unknown>[])[0]!.types = ['fighting', 'none'];
    expect(loadGameData(raw).species.get('medicham')?.types).toEqual(['fighting']);
  });

  it('rejects a species that references an unknown move', () => {
    const raw = minimal();
    (raw.pokemon as Record<string, unknown>[])[0]!.fastMoves = ['NOPE'];
    expect(() => loadGameData(raw)).toThrow(new GameDataError('medicham: unknown fast move NOPE'));
  });

  it('reads levelFloor, defaulting to 1 like PvPoke baseLevelFloor', () => {
    expect(loadGameData(minimal()).species.get('medicham')?.levelFloor).toBe(1);
    const raw = minimal();
    (raw.pokemon as Record<string, unknown>[])[0]!.levelFloor = 15;
    expect(loadGameData(raw).species.get('medicham')?.levelFloor).toBe(15);
    expect(loadDefaultGameData().species.get('heatran_shadow')?.levelFloor).toBe(8);
  });

  it.each([0, 15.25, 'fifteen'])('rejects levelFloor %j', (value) => {
    const raw = minimal();
    (raw.pokemon as Record<string, unknown>[])[0]!.levelFloor = value;
    expect(() => loadGameData(raw)).toThrow(GameDataError);
  });

  it('rejects a move with a non-numeric power', () => {
    const raw = minimal();
    (raw.moves as Record<string, unknown>[])[0]!.power = 'eight';
    expect(() => loadGameData(raw)).toThrow(GameDataError);
  });

  it('derives self-debuffing flags like PvPoke (Superpower)', () => {
    const gd = loadDefaultGameData();
    expect(gd.moves.get('SUPER_POWER')).toMatchObject({
      selfDebuffing: true, selfAttackDebuffing: true, selfDefenseDebuffing: true, selfBuffing: false,
    });
    expect(gd.moves.get('PSYCHIC')).toMatchObject({ selfDebuffing: false, selfBuffing: false });
    expect(gd.moves.get('PSYCHIC')?.buffs?.chance).toBe(0.1);
  });

  it('defaults formChange to null and released to true', () => {
    const medicham = loadGameData(minimal()).species.get('medicham');
    expect(medicham?.formChange).toBeNull();
    expect(medicham?.released).toBe(true);
  });

  it('parses a formChange block', () => {
    const raw = minimal();
    (raw.pokemon as Record<string, unknown>[])[0]!.formChange = {
      type: 'set', trigger: 'charged_move_damage', effect: 'protect', moveId: 'ANY', alternativeFormId: 'medicham', resetOnSwitch: false,
    };
    expect(loadGameData(raw).species.get('medicham')?.formChange).toEqual({
      trigger: 'charged_move_damage', effect: 'protect', moveId: 'ANY', moveIds: null, alternativeFormId: 'medicham', resetOnSwitch: false,
    });
  });

  it('rejects a malformed formChange or released flag', () => {
    const badTrigger = minimal();
    (badTrigger.pokemon as Record<string, unknown>[])[0]!.formChange = { trigger: 7 };
    expect(() => loadGameData(badTrigger)).toThrow(GameDataError);
    const badReleased = minimal();
    (badReleased.pokemon as Record<string, unknown>[])[0]!.released = 'yes';
    expect(() => loadGameData(badReleased)).toThrow(new GameDataError('medicham: released must be a boolean'));
  });

  it('reads Mimikyu and Morpeko form changes, with the Morpeko correction applied', () => {
    const gd = loadDefaultGameData();
    expect(gd.species.get('mimikyu')?.formChange).toEqual({
      trigger: 'charged_move_damage', effect: 'protect', moveId: 'ANY', moveIds: null, alternativeFormId: 'mimikyu_busted', resetOnSwitch: false,
    });
    expect(gd.species.get('mimikyu_busted')?.released).toBe(false);
    expect(gd.species.get('morpeko_full_belly')?.formChange?.alternativeFormId).toBe('morpeko_hangry');
    // PvPoke's gamemaster has no rule on morpeko_hangry; FORM_CHANGE_CORRECTIONS adds the switch back (ADR 0003).
    expect(gd.species.get('morpeko_hangry')?.formChange).toEqual({
      trigger: 'charged_move', effect: null, moveId: 'ANY', moveIds: null, alternativeFormId: 'morpeko_full_belly', resetOnSwitch: true,
    });
  });

  it('loads the vendored gamemaster', () => {
    const gd = loadDefaultGameData();
    expect(gd.species.size).toBeGreaterThan(1500);
    expect(gd.species.get('mimikyu')?.formChange).not.toBeNull();
    expect(gd.species.get('registeel_shadow')?.tags).toContain('shadow');
  });
});
