import { describe, expect, it } from 'vitest';
import { battleReducer, initialBattle, type BattleAction, type BattleState } from '../src/companion';

const run = (actions: readonly BattleAction[], from: BattleState = initialBattle()): BattleState => actions.reduce(battleReducer, from);

describe('initialBattle', () => {
  it('starts at 2-2 with the lead on the field', () => {
    const s = initialBattle();
    expect(s.now).toMatchObject({ myShields: 2, theirShields: 2, onField: 0, fainted: [false, false, false], opponents: [], current: null, awaitingWhoIsIn: false, notice: null });
    expect(s.past).toEqual([]);
  });
});

describe('shields', () => {
  it('never go below 0, and a no-op adds no undo entry', () => {
    const s = run([{ type: 'iShielded' }, { type: 'iShielded' }, { type: 'iShielded' }, { type: 'theyShielded' }]);
    expect(s.now.myShields).toBe(0);
    expect(s.now.theirShields).toBe(1);
    expect(s.past).toHaveLength(3);
  });
});

describe('opponents', () => {
  it('appends and selects a new opponent', () => {
    const s = run([{ type: 'addOpponent', speciesId: 'melmetal' }, { type: 'addOpponent', speciesId: 'azumarill' }]);
    expect(s.now.opponents.map((o) => o.speciesId)).toEqual(['melmetal', 'azumarill']);
    expect(s.now.current).toBe(1);
  });

  it('selects an opponent already seen instead of adding it again', () => {
    const s = run([{ type: 'addOpponent', speciesId: 'melmetal' }, { type: 'addOpponent', speciesId: 'azumarill' }, { type: 'addOpponent', speciesId: 'melmetal' }]);
    expect(s.now.opponents).toHaveLength(2);
    expect(s.now.current).toBe(0);
  });

  it('refuses a 4th distinct opponent with a notice', () => {
    const three = run(['a', 'b', 'c'].map((speciesId): BattleAction => ({ type: 'addOpponent', speciesId })));
    const s = battleReducer(three, { type: 'addOpponent', speciesId: 'd' });
    expect(s.now.opponents).toHaveLength(3);
    expect(s.now.current).toBe(2);
    expect(s.now.notice).toMatch(/3 opponents/);
    expect(s.past).toEqual(three.past);
    expect(battleReducer(s, { type: 'iShielded' }).now.notice).toBeNull();
  });

  it('marks the current opponent fainted', () => {
    const s = run([{ type: 'addOpponent', speciesId: 'a' }, { type: 'addOpponent', speciesId: 'b' }, { type: 'selectOpponent', index: 0 }, { type: 'theirsFainted' }]);
    expect(s.now.opponents.map((o) => o.fainted)).toEqual([true, false]);
  });

  it('ignores theirsFainted with no opponent and an out-of-range selection', () => {
    const s = run([{ type: 'theirsFainted' }, { type: 'selectOpponent', index: 5 }]);
    expect(s.past).toHaveLength(0);
  });
});

describe('my faints and switches', () => {
  it('asks who is in when two are left', () => {
    const s = run([{ type: 'mineFainted' }]);
    expect(s.now).toMatchObject({ fainted: [true, false, false], onField: null, awaitingWhoIsIn: true });
  });

  it('switches the last one in automatically', () => {
    const s = run([{ type: 'mineFainted' }, { type: 'switchIn', slot: 2 }, { type: 'mineFainted' }]);
    expect(s.now).toMatchObject({ fainted: [true, false, true], onField: 1, awaitingWhoIsIn: false });
  });

  it('leaves nothing on the field when all three are down, and further faints are no-ops', () => {
    const s = run([{ type: 'mineFainted' }, { type: 'switchIn', slot: 1 }, { type: 'mineFainted' }, { type: 'mineFainted' }]);
    expect(s.now).toMatchObject({ fainted: [true, true, true], onField: null, awaitingWhoIsIn: false });
    const again = battleReducer(s, { type: 'mineFainted' });
    expect(again).toBe(s);
  });

  it('ignores switching in a fainted slot', () => {
    const s = run([{ type: 'mineFainted' }]);
    expect(battleReducer(s, { type: 'switchIn', slot: 0 })).toBe(s);
  });

  it('clears the who-is-in prompt on switch-in', () => {
    const s = run([{ type: 'mineFainted' }, { type: 'switchIn', slot: 1 }]);
    expect(s.now).toMatchObject({ onField: 1, awaitingWhoIsIn: false });
  });

  it('identifies team members by slot, so duplicate species stay independent', () => {
    // A team of [azumarill, medicham, azumarill]: fainting slot 0 must not touch slot 2.
    const s = run([{ type: 'mineFainted' }, { type: 'switchIn', slot: 2 }]);
    expect(s.now.fainted).toEqual([true, false, false]);
    expect(s.now.onField).toBe(2);
  });
});

describe('undo and new battle', () => {
  it('restores the exact previous snapshot', () => {
    const before = run([{ type: 'addOpponent', speciesId: 'melmetal' }, { type: 'iShielded' }]);
    const after = battleReducer(before, { type: 'mineFainted' });
    expect(battleReducer(after, { type: 'undo' })).toEqual(before);
    expect(battleReducer(after, { type: 'undo' }).now).toBe(before.now);
  });

  it('is a no-op with nothing to undo', () => {
    const s = initialBattle();
    expect(battleReducer(s, { type: 'undo' })).toBe(s);
  });

  it('caps the history at 50', () => {
    let s = initialBattle();
    for (let i = 0; i < 60; i++) s = battleReducer(s, { type: 'switchIn', slot: i % 2 === 0 ? 1 : 0 });
    expect(s.past).toHaveLength(50);
  });

  it('starts fresh on a new battle', () => {
    const s = run([{ type: 'addOpponent', speciesId: 'melmetal' }, { type: 'iShielded' }, { type: 'newBattle' }]);
    expect(s).toEqual(initialBattle());
  });
});
