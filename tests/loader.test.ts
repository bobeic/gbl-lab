import { describe, expect, it } from 'vitest';
import { GameDataError } from '../src/errors';
import { loadDefaultGameData, loadGameData } from '../src/data';

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

  it('loads the vendored gamemaster', () => {
    const gd = loadDefaultGameData();
    expect(gd.species.size).toBeGreaterThan(1500);
    expect(gd.species.get('mimikyu')?.hasFormChange).toBe(true);
    expect(gd.species.get('registeel_shadow')?.tags).toContain('shadow');
  });
});
