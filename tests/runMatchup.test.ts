import { describe, expect, it } from 'vitest';
import { loadDefaultGameData } from '../src/data';
import { TurnLimitError } from '../src/errors';
import { buildCombatant } from '../src/engine/combatant';
import { FastOnlyPolicy, GreedyPolicy, ScriptedPolicy } from '../src/policy/testPolicies';
import { battleRating } from '../src/sim/rating';
import { runMatchup } from '../src/sim/runMatchup';

const gd = loadDefaultGameData();
const med = buildCombatant(gd, { speciesId: 'medicham', fastMoveId: 'COUNTER', chargedMoveIds: ['ICE_PUNCH', 'DYNAMIC_PUNCH'] });
const azu = buildCombatant(gd, { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM', 'HYDRO_PUMP'] });
const fast = new FastOnlyPolicy();

describe('battleRating', () => {
  it('matches PvPoke formula', () => {
    expect(battleRating(19, 191, 0, 141)).toBe(549);
    expect(battleRating(0, 141, 19, 191)).toBe(450);
    expect(battleRating(0, 141, 0, 141)).toBe(500);
  });
});

describe('runMatchup', () => {
  it('fast-only Medicham vs Azumarill = 450 / 549 (PvPoke)', () => {
    const r = runMatchup(gd, med, azu, { shields: [0, 0], policies: [fast, fast] });
    expect(r.ratings).toEqual([450, 549]);
    expect(r.winner).toBe(1);
  });

  it('scripted Ice Beam on turn 40 and Dynamic Punch on turn 50 = 416 / 583 (PvPoke sandbox)', () => {
    const script = new ScriptedPolicy([
      { side: 0, turn: 20, index: 0, shielded: true },
      { side: 0, turn: 50, index: 1, shielded: false },
      { side: 1, turn: 40, index: 0, shielded: false },
    ]);
    const r = runMatchup(gd, med, azu, { shields: [1, 1], policies: [script, script] });
    expect(r.ratings).toEqual([416, 583]);
    const charged = r.events.filter((e) => e.kind === 'charged').map((e) => [e.turn, e.side, e.moveId, e.damage]);
    expect(charged).toEqual([[40, 1, 'ICE_BEAM', 40], [50, 0, 'DYNAMIC_PUNCH', 35]]);
  });

  it('ties are reported as no winner', () => {
    const r = runMatchup(gd, med, med, { shields: [0, 0], policies: [fast, fast] });
    expect(r.winner).toBeNull();
    expect(r.ratings).toEqual([500, 500]);
  });

  it('greedy policy throws charged moves and works with one charged move', () => {
    const solo = buildCombatant(gd, { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM'] });
    const greedy = new GreedyPolicy();
    const r = runMatchup(gd, med, solo, { shields: [1, 1], policies: [greedy, greedy] });
    expect(r.events.some((e) => e.kind === 'charged')).toBe(true);
    expect(r.shields).toEqual([0, 0]);
  });

  it('throws TurnLimitError with events attached', () => {
    try {
      runMatchup(gd, med, azu, { shields: [0, 0], policies: [fast, fast], maxTurns: 10 });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(TurnLimitError);
      expect((e as TurnLimitError).events.length).toBeGreaterThan(0);
    }
  });
});
