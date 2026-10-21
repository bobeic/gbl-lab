import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildAppDataFile, loadAppData } from '../src/companion';
import { loadDefaultGameData } from '../src/data/node';
import { GameDataError } from '../src/errors';

const gmText = readFileSync('data/gamemaster.json', 'utf8');
const rkText = readFileSync('data/rankings-1500.json', 'utf8');
const file = buildAppDataFile(JSON.parse(gmText), JSON.parse(rkText), 'abc123');
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

  it('rejects a file without the expected shape', () => {
    expect(() => loadAppData({})).toThrow(GameDataError);
  });

  it('rejects a ranking row with an empty moveset', () => {
    const bad = { ...file, rankings: [{ speciesId: 'melmetal', speciesName: 'Melmetal', moveset: [] }] };
    expect(() => loadAppData(bad)).toThrow(GameDataError);
  });
});
