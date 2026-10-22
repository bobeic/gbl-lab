import { describe, expect, it } from 'vitest';
import { appReducer } from '../../app/src/appState';
import { defaultSavedApp, type SavedApp } from '../../src/companion';
import type { RosterEntry } from '../../src/matrix/teamMatrix';

const entry = (speciesId: string): RosterEntry => ({ speciesId, fastMoveId: 'X', chargedMoveIds: ['Y'] });
const roster = ['melmetal', 'medicham', 'azumarill', 'registeel', 'mimikyu'].map(entry);
const base = defaultSavedApp();
const state: SavedApp = {
  ...base, roster,
  byFormat: { great: { ...base.byFormat.great, team: [1, 2, 3] }, fantasy: { ...base.byFormat.fantasy, team: [4, 0, 3] } },
};

describe('appReducer', () => {
  it('switches format without touching either team', () => {
    const next = appReducer(state, { type: 'setFormat', format: 'fantasy' });
    expect(next.format).toBe('fantasy');
    expect(next.byFormat).toBe(state.byFormat);
  });

  it('sets the team, battle and priorities of the current format only', () => {
    const inFantasy = appReducer(state, { type: 'setFormat', format: 'fantasy' });
    const next = appReducer(appReducer(inFantasy, { type: 'setTeam', roster, team: [0, 3, 4] }), { type: 'setPriorities', priorities: ['mimikyu'] });
    expect(next.byFormat.fantasy.team).toEqual([0, 3, 4]);
    expect(next.byFormat.fantasy.priorities).toEqual(['mimikyu']);
    expect(next.byFormat.great).toEqual(state.byFormat.great);
    const battled = appReducer(next, { type: 'battle', action: { type: 'addOpponent', speciesId: 'melmetal' } });
    expect(battled.byFormat.fantasy.battle).not.toEqual(next.byFormat.fantasy.battle);
    expect(battled.byFormat.great.battle).toBe(next.byFormat.great.battle);
  });

  it("deleting a collection Pokémon shifts another format's team, or drops it if the Pokémon was in it", () => {
    // Great League deletes medicham (index 1): Fantasy's [4, 0, 3] becomes [3, 0, 2].
    const withoutMedicham = roster.filter((_, i) => i !== 1);
    expect(appReducer(state, { type: 'setTeam', roster: withoutMedicham, team: null }).byFormat.fantasy.team).toEqual([3, 0, 2]);
    // Deleting melmetal (index 0) removes a Fantasy team member.
    expect(appReducer(state, { type: 'setTeam', roster: roster.slice(1), team: null }).byFormat.fantasy.team).toBeNull();
    // Adding one changes no indices.
    expect(appReducer(state, { type: 'setTeam', roster: [...roster, entry('altaria')], team: [1, 2, 3] }).byFormat.fantasy.team).toEqual([4, 0, 3]);
  });

  it('sets and clears a seen moveset in the current format only', () => {
    const set = appReducer(state, { type: 'setMoves', speciesId: 'turtonator', moveset: ['INCINERATE', 'BRUTAL_SWING', 'OVERHEAT'] });
    expect(set.byFormat.great.moves).toEqual({ turtonator: ['INCINERATE', 'BRUTAL_SWING', 'OVERHEAT'] });
    expect(set.byFormat.fantasy).toBe(state.byFormat.fantasy);
    expect(appReducer(set, { type: 'setMoves', speciesId: 'turtonator', moveset: null }).byFormat.great.moves).toEqual({});
  });
});
