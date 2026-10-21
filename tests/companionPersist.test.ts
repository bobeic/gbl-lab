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
const app: SavedApp = { version: 1, roster, team: [2, 0, 1], battle: battle.reduce(battleReducer, initialBattle()), priorities: ['melmetal'] };
const withSaved = (value: unknown) => memoryStore({ [STORAGE_KEY]: JSON.stringify(value) });

describe('save / loadSaved', () => {
  it('round-trips roster, team, battle and priorities', () => {
    const store = memoryStore();
    expect(save(store, app)).toBe(true);
    expect(loadSaved(store)).toEqual(app);
  });

  it('defaults to an empty roster, no team and a fresh battle', () => {
    expect(defaultSavedApp()).toEqual({ version: 1, roster: [], team: null, battle: initialBattle(), priorities: [] });
    expect(loadSaved(memoryStore())).toEqual(defaultSavedApp());
  });

  it.each([
    ['garbage JSON', memoryStore({ [STORAGE_KEY]: '{not json' })],
    ['a newer version', withSaved({ ...app, version: 2 })],
    ['a team index out of range', withSaved({ ...app, team: [0, 1, 3] })],
    ['a repeated team index', withSaved({ ...app, team: [0, 0, 1] })],
    ['a malformed roster', withSaved({ ...app, roster: [{ speciesId: 'azumarill' }] })],
    ['a store that throws', { getItem: () => { throw new Error('SecurityError'); }, setItem: () => {} }],
    ['no store', null],
  ])('falls back to the default for %s', (_, store) => {
    expect(loadSaved(store)).toEqual(defaultSavedApp());
  });

  it('keeps the roster and starts a fresh battle when only the battle is malformed', () => {
    const bad = { ...app, battle: { now: { ...app.battle.now, myShields: -1 }, past: [] } };
    expect(loadSaved(withSaved(bad))).toEqual({ ...app, battle: initialBattle() });
  });

  it('keeps everything else when priorities are missing or malformed', () => {
    const { priorities: _, ...old } = app;
    expect(loadSaved(withSaved(old))).toEqual({ ...app, priorities: [] });
    expect(loadSaved(withSaved({ ...app, priorities: [7] }))).toEqual({ ...app, priorities: [] });
  });

  it('returns false instead of throwing when storage is full or missing', () => {
    const full: KeyValueStore = { getItem: () => null, setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); } };
    expect(save(full, app)).toBe(false);
    expect(save(null, app)).toBe(false);
  });
});
