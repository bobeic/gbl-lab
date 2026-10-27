import { describe, expect, it } from 'vitest';
import { battleReducer, defaultSavedApp, initialBattle, loadSaved, save, STORAGE_KEY, type KeyValueStore, type SavedApp } from '../src/companion';

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
}

const roster = [
  { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM', 'PLAY_ROUGH'], ivs: { atk: 0, def: 15, hp: 15 } },
  { speciesId: 'medicham', fastMoveId: 'PSYCHO_CUT', chargedMoveIds: ['ICE_PUNCH', 'DYNAMIC_PUNCH'] },
  { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM', 'HYDRO_PUMP'], label: 'Azu #2' },
];
const battle = [{ type: 'addOpponent', speciesId: 'melmetal' }, { type: 'iShielded' }, { type: 'mineFainted' }] as const;
const great = { team: [2, 0, 1] as const, battle: battle.reduce(battleReducer, initialBattle()), priorities: ['melmetal'], moves: { turtonator: ['INCINERATE', 'BRUTAL_SWING', 'OVERHEAT'] as const } };
const fantasy = { team: [0, 2, 1] as const, battle: initialBattle(), priorities: ['mimikyu'], moves: {} };
const halloweenmega = { team: null, battle: initialBattle(), priorities: [], moves: {} };
const app: SavedApp = { version: 2, roster, format: 'fantasy', byFormat: { great, fantasy, halloweenmega } };
const withSaved = (value: unknown) => memoryStore({ [STORAGE_KEY]: JSON.stringify(value) });

describe('save / loadSaved', () => {
  it('round-trips roster, format and every format\'s team, battle and priorities', () => {
    const store = memoryStore();
    expect(save(store, app)).toBe(true);
    expect(loadSaved(store)).toEqual(app);
  });

  it('defaults to an empty roster, Great League, and nothing picked in any format', () => {
    const empty = { team: null, battle: initialBattle(), priorities: [], moves: {} };
    expect(defaultSavedApp()).toEqual({ version: 2, roster: [], format: 'great', byFormat: { great: empty, fantasy: empty, halloweenmega: empty } });
    expect(loadSaved(memoryStore())).toEqual(defaultSavedApp());
  });

  it.each([
    ['garbage JSON', memoryStore({ [STORAGE_KEY]: '{not json' })],
    ['a newer version', withSaved({ ...app, version: 3 })],
    ['a malformed roster', withSaved({ ...app, roster: [{ speciesId: 'azumarill' }] })],
    ['a store that throws', { getItem: () => { throw new Error('SecurityError'); }, setItem: () => {} }],
    ['no store', null],
  ])('falls back to the default for %s', (_, store) => {
    expect(loadSaved(store)).toEqual(defaultSavedApp());
  });

  it.each([
    ['out of range', [0, 1, 3]],
    ['repeated', [0, 0, 1]],
  ])('drops only that format\'s team when it is %s', (_, team) => {
    const bad = { ...app, byFormat: { ...app.byFormat, great: { ...great, team } } };
    expect(loadSaved(withSaved(bad))).toEqual({ ...app, byFormat: { great: { ...great, team: null }, fantasy, halloweenmega } });
  });

  it('keeps the roster and starts a fresh battle when only a battle is malformed', () => {
    const bad = { ...app, byFormat: { ...app.byFormat, great: { ...great, battle: { now: { ...great.battle.now, myShields: -1 }, past: [] } } } };
    expect(loadSaved(withSaved(bad))).toEqual({ ...app, byFormat: { great: { ...great, battle: initialBattle() }, fantasy, halloweenmega } });
  });

  it('defaults priorities when missing or malformed, and an unknown format to Great League', () => {
    const { priorities: _, ...noPriorities } = great;
    expect(loadSaved(withSaved({ ...app, byFormat: { great: noPriorities, fantasy, halloweenmega } })).byFormat.great.priorities).toEqual([]);
    expect(loadSaved(withSaved({ ...app, byFormat: { great: { ...great, priorities: [7] }, fantasy, halloweenmega } })).byFormat.great.priorities).toEqual([]);
    expect(loadSaved(withSaved({ ...app, format: 'ultra' })).format).toBe('great');
  });

  it('defaults moves when missing, and drops only a malformed moveset', () => {
    const { moves: _, ...noMoves } = great;
    expect(loadSaved(withSaved({ ...app, byFormat: { great: noMoves, fantasy, halloweenmega } })).byFormat.great.moves).toEqual({});
    const moves = { ...great.moves, melmetal: ['THUNDER_SHOCK'], azumarill: 'BUBBLE' };
    expect(loadSaved(withSaved({ ...app, byFormat: { great: { ...great, moves }, fantasy, halloweenmega } })).byFormat.great.moves).toEqual(great.moves);
    const superMega = { greninja_mega: ['WATER_SHURIKEN', 'HYDRO_CANNON', 'BRUTAL_SWING', 'SURF_PLUS'] };
    expect(loadSaved(withSaved({ ...app, byFormat: { great, fantasy, halloweenmega: { ...halloweenmega, moves: superMega } } })).byFormat.halloweenmega.moves).toEqual(superMega);
  });

  it('a format missing from the save starts empty', () => {
    expect(loadSaved(withSaved({ ...app, byFormat: { great } })).byFormat.fantasy).toEqual({ team: null, battle: initialBattle(), priorities: [], moves: {} });
  });

  it('migrates a version-1 save into Great League', () => {
    const v1 = { version: 1, roster, ...great };
    const empty = { team: null, battle: initialBattle(), priorities: [], moves: {} };
    expect(loadSaved(withSaved(v1))).toEqual({ version: 2, roster, format: 'great', byFormat: { great, fantasy: empty, halloweenmega: empty } });
    const { priorities: _, ...v1NoPriorities } = v1;
    expect(loadSaved(withSaved(v1NoPriorities)).byFormat.great).toEqual({ ...great, priorities: [] });
  });

  it('returns false instead of throwing when storage is full or missing', () => {
    const full: KeyValueStore = { getItem: () => null, setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); } };
    expect(save(full, app)).toBe(false);
    expect(save(null, app)).toBe(false);
  });
});
