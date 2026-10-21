import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildAppDataFile, formatEntry, loadAppData, loadFormats } from '../src/companion';
import { loadDefaultGameData } from '../src/data/node';
import { GameDataError } from '../src/errors';
import { vendoredRankings } from './companionFixture';

const gmText = readFileSync('data/gamemaster.json', 'utf8');
const rkText = readFileSync('data/rankings-1500.json', 'utf8') + readFileSync('data/rankings-fantasy-1500.json', 'utf8');
const file = buildAppDataFile(JSON.parse(gmText), vendoredRankings(), 'abc123');
const app = loadAppData(JSON.parse(JSON.stringify(file)));

describe('buildAppDataFile / loadAppData', () => {
  it('keeps every ranked species in rank order', () => {
    expect(app.ranked).toHaveLength(1154);
    expect(app.ranked[0]!.rank).toBe(0);
    expect(app.ranked[1152]!.rank).toBe(1152);
  });

  it('indexes ranked species by id with their ranking moveset', () => {
    const mel = app.byId.get('melmetal');
    expect(mel?.rank).toBe(0);
    expect(mel?.name).toBe('Melmetal');
    expect(mel?.moveset).toEqual(['THUNDER_SHOCK', 'DOUBLE_IRON_BASH', 'DYNAMIC_PUNCH']);
  });

  it('keeps every gamemaster species so form partners resolve', () => {
    expect(app.gd.species.size).toBe(loadDefaultGameData().species.size);
  });

  it('is smaller than the raw files combined', () => {
    expect(JSON.stringify(file).length).toBeLessThan(gmText.length + rkText.length);
    expect(file.upstream).toBe('abc123');
  });

  it('loads Fantasy Cup with its own rankings and movesets over the same game data', () => {
    const { great, fantasy } = loadFormats(JSON.parse(JSON.stringify(file)));
    expect(fantasy.format.title).toBe('Fantasy Cup');
    expect(fantasy.gd).toBe(great.gd);
    expect(fantasy.ranked.length).toBeLessThan(great.ranked.length);
    expect(fantasy.byId.has('medicham')).toBe(false);
    expect(fantasy.byId.get('turtonator')?.moveset).toEqual(['INCINERATE', 'DRAGON_CLAW', 'OVERHEAT']);
    expect(great.byId.get('turtonator')?.moveset).toEqual(['INCINERATE', 'BRUTAL_SWING', 'DRAGON_CLAW']);
  });

  it('formatEntry gives a Pokémon the format\'s moves and keeps its IVs', () => {
    const { great, fantasy } = loadFormats(JSON.parse(JSON.stringify(file)));
    const turt = { speciesId: 'turtonator', fastMoveId: 'EMBER', chargedMoveIds: ['FLAMETHROWER'], ivs: { atk: 1, def: 15, hp: 15 } };
    expect(formatEntry(fantasy, turt)).toEqual({ ...turt, fastMoveId: 'INCINERATE', chargedMoveIds: ['DRAGON_CLAW', 'OVERHEAT'] });
    expect(formatEntry(great, turt).chargedMoveIds).toEqual(['BRUTAL_SWING', 'DRAGON_CLAW']);
    const unranked = { speciesId: 'medicham', fastMoveId: 'COUNTER', chargedMoveIds: ['ICE_PUNCH'] };
    expect(formatEntry(fantasy, unranked)).toBe(unranked);
  });

  it('rejects a file missing a format', () => {
    expect(() => loadFormats({ ...file, formats: [file.formats[0]] })).toThrow(/Fantasy Cup/);
  });

  it('rejects a file without the expected shape', () => {
    expect(() => loadAppData({})).toThrow(GameDataError);
  });

  it('rejects a ranking row with an empty moveset', () => {
    const bad = { ...file, formats: [{ id: 'great', rankings: [{ speciesId: 'melmetal', speciesName: 'Melmetal', moveset: [] }] }, file.formats[1]] };
    expect(() => loadAppData(bad)).toThrow(GameDataError);
  });
});
