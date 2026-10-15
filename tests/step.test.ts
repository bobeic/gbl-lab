import { describe, expect, it } from 'vitest';
import { loadDefaultGameData } from '../src/data/node';
import { IllegalActionError } from '../src/errors';
import { buildCombatant } from '../src/engine/combatant';
import { createBattle, type BattleState } from '../src/engine/state';
import type { BattleEvent } from '../src/engine/turn';
import { PvPokeLikePolicy } from '../src/policy/pvpoke';
import type { Policy } from '../src/policy/types';
import { runBattle, runMatchup } from '../src/sim/runMatchup';
import { step } from '../src/sim/step';

const gd = loadDefaultGameData();
const med = buildCombatant(gd, { speciesId: 'medicham', fastMoveId: 'COUNTER', chargedMoveIds: ['ICE_PUNCH', 'PSYCHIC'] });
const azu = buildCombatant(gd, { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM', 'PLAY_ROUGH'] });
const rules = { maxBuffStages: gd.maxBuffStages, buffDivisor: gd.buffDivisor };
const policies = (): [Policy, Policy] => [new PvPokeLikePolicy(), new PvPokeLikePolicy()];
const start = (): BattleState => createBattle([med, azu], { shields: [1, 1] }, rules);

describe('step', () => {
  const expected = runMatchup(gd, med, azu, { shields: [1, 1], policies: policies() });

  it('reproduces runMatchup turn by turn', () => {
    const ps = policies();
    let state = start();
    const events: BattleEvent[] = [];
    while (!state.over) {
      const turn = state.turn;
      const r = step(state, ps);
      expect(r.state.turn).toBe(turn + 1);
      expect(r.events.every((e) => e.turn === turn)).toBe(true);
      events.push(...r.events);
      state = r.state;
    }
    expect(events).toEqual(expected.events);
    expect([state.sides[0].hp, state.sides[1].hp]).toEqual(expected.hp);
    // Medicham vs Azumarill 1-1 is PvPoke's 324/675 (pvpokeDecide.test.ts).
    expect(expected.ratings).toEqual([324, 675]);
  });

  it('lets runBattle continue from a mid-battle state', () => {
    const ps = policies();
    let state = start();
    const events: BattleEvent[] = [];
    for (let i = 0; i < 30; i++) {
      const r = step(state, ps);
      events.push(...r.events);
      state = r.state;
    }
    const rest = runBattle(state, { policies: ps });
    expect([...events, ...rest.events]).toEqual(expected.events);
    expect(rest.ratings).toEqual(expected.ratings);
    expect(rest.turns).toBe(expected.turns);
  });

  it('rejects a battle that is already over', () => {
    const ps = policies();
    let state = start();
    while (!state.over) state = step(state, ps).state;
    expect(() => step(state, ps)).toThrow(IllegalActionError);
  });
});
