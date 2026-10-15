import { describe, expect, it } from 'vitest';
import { loadDefaultGameData } from '../src/data';
import { IllegalActionError } from '../src/errors';
import { buildCombatant, type CombatantSpec } from '../src/engine/combatant';
import { createBattle, type BattleState, type Side } from '../src/engine/state';
import { beginTurn, canAct, resolveTurn, type Action, type BattleEvent, type ShieldDecider } from '../src/engine/turn';

const gd = loadDefaultGameData();
const rules = { maxBuffStages: gd.maxBuffStages, buffDivisor: gd.buffDivisor };
const med = (charged: string[] = ['ICE_PUNCH', 'PSYCHIC']): CombatantSpec => ({ speciesId: 'medicham', fastMoveId: 'COUNTER', chargedMoveIds: charged });
const azu: CombatantSpec = { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM', 'PLAY_ROUGH'] };

function battle(a: CombatantSpec, b: CombatantSpec, shields: [number, number] = [0, 0], startEnergy?: [number, number]): BattleState {
  return createBattle([buildCombatant(gd, a), buildCombatant(gd, b)], { shields, startEnergy }, rules);
}

const never: ShieldDecider = () => false;
const always: ShieldDecider = () => true;

/** Drive one turn where each side that can act uses the given chooser. */
function turn(s: BattleState, choose: (st: BattleState, side: Side) => Action, shield: ShieldDecider = never) {
  const pre = beginTurn(s);
  const actions = [0, 1].map((side) => (canAct(pre, side as Side) ? choose(pre, side as Side) : null)) as [Action | null, Action | null];
  return resolveTurn(pre, actions, shield);
}

function runFastOnly(s: BattleState): { state: BattleState; events: BattleEvent[] } {
  const events: BattleEvent[] = [];
  while (!s.over) {
    const r = turn(s, () => ({ type: 'fast' }));
    events.push(...r.events);
    s = r.state;
  }
  return { state: s, events };
}

describe('fast move timing', () => {
  it('lands a 2-turn move on turn 2 and a 3-turn move on turn 3', () => {
    const { events } = runFastOnly(battle(med(), azu));
    const fasts = events.filter((e) => e.kind === 'fast').slice(0, 3);
    expect(fasts.map((e) => [e.turn, e.side, e.damage])).toEqual([[2, 0, 4], [3, 1, 5], [4, 0, 4]]);
  });

  it('Medicham vs Azumarill fast-only ends on turn 87 with Azumarill at 19 HP (PvPoke: 450/549)', () => {
    const { state, events } = runFastOnly(battle(med(), azu));
    expect(state.sides[0].hp).toBe(0);
    expect(state.sides[1].hp).toBe(19);
    expect(events.at(-1)).toEqual({ kind: 'faint', turn: 87, side: 0 });
  });

  it('mirror double-KOs on the same turn', () => {
    const { state } = runFastOnly(battle(med(), med()));
    expect(state.sides.map((s) => s.hp)).toEqual([0, 0]);
  });

  it('caps energy at 100', () => {
    let s = battle(med(), { ...azu, speciesId: 'azumarill' });
    for (let i = 0; i < 40; i++) s = turn(s, () => ({ type: 'fast' })).state;
    expect(s.sides[0].energy).toBe(100);
  });
});

describe('charged moves', () => {
  it('spends energy, deals cached damage and blocks to 1 with a shield', () => {
    let s = battle(med(), azu, [1, 1], [40, 0]);
    const r = turn(s, (_st, side) => (side === 0 ? { type: 'charged', index: 0 } : { type: 'fast' }), always);
    s = r.state;
    expect(s.sides[0].energy).toBe(0);
    expect(s.sides[0].lastDamage.charged[0]).toBe(20);
    expect(s.sides[1].shields).toBe(0);
    expect(s.sides[1].hp).toBe(191 - 1);
    expect(r.events.find((e) => e.kind === 'charged')).toMatchObject({ side: 0, damage: 1, shielded: true });
  });

  it('resets both cooldowns to 500 and blocks new actions the next turn', () => {
    const s = turn(battle(med(), azu, [0, 0], [40, 0]), (_st, side) => (side === 0 ? { type: 'charged', index: 0 } : { type: 'fast' })).state;
    expect(s.sides.map((x) => x.cooldownMs)).toEqual([500, 500]);
    const pre = beginTurn(s);
    expect(canAct(pre, 0)).toBe(false);
    expect(canAct(pre, 1)).toBe(false);
  });

  it('resolves the higher raw attack first (CMP)', () => {
    const r = turn(battle(med(), azu, [0, 0], [100, 100]), () => ({ type: 'charged', index: 0 }));
    const order = r.events.filter((e) => e.kind === 'charged').map((e) => e.side);
    expect(order).toEqual([0, 1]);
  });

  it('with equal attack both charged moves resolve even if the first KOs', () => {
    const lowHp = battle(med(), med(), [0, 0], [100, 100]);
    const s = { ...lowHp, sides: [{ ...lowHp.sides[0], hp: 1 }, { ...lowHp.sides[1], hp: 1 }] as const };
    const r = turn(s, () => ({ type: 'charged', index: 0 }));
    expect(r.events.filter((e) => e.kind === 'charged')).toHaveLength(2);
    expect(r.state.sides.map((x) => x.hp)).toEqual([0, 0]);
  });

  it('with different attack the KO-d side does not fire', () => {
    const base = battle(med(), azu, [0, 0], [100, 100]);
    const s = { ...base, sides: [base.sides[0], { ...base.sides[1], hp: 1 }] as const };
    const r = turn(s, () => ({ type: 'charged', index: 0 }));
    expect(r.events.filter((e) => e.kind === 'charged').map((e) => e.side)).toEqual([0]);
  });

  it('rejects a charged move without enough energy', () => {
    const pre = beginTurn(battle(med(), azu));
    expect(() => resolveTurn(pre, [{ type: 'charged', index: 0 }, null], never)).toThrow(IllegalActionError);
  });

  it('rejects an action from a side that cannot act', () => {
    const s = turn(battle(med(), azu), () => ({ type: 'fast' })).state; // Medicham now mid-Counter
    const pre = beginTurn(s);
    expect(canAct(pre, 0)).toBe(false);
    expect(() => resolveTurn(pre, [{ type: 'fast' }, null], never)).toThrow(IllegalActionError);
  });
});

describe('buffs', () => {
  it('applies guaranteed self buffs (Power-Up Punch +1 atk)', () => {
    const r = turn(battle(med(['POWER_UP_PUNCH']), azu, [0, 0], [35, 0]), (_s, side) => (side === 0 ? { type: 'charged', index: 0 } : { type: 'fast' }));
    expect(r.state.sides[0].buffs).toEqual([1, 0]);
  });

  it('applies opponent debuffs even when shielded (Acid Spray -2 def)', () => {
    const s = createBattle(
      [buildCombatant(gd, { speciesId: 'qwilfish', fastMoveId: 'POISON_STING', chargedMoveIds: ['ACID_SPRAY'] }), buildCombatant(gd, azu)],
      { shields: [0, 1], startEnergy: [45, 0] }, rules,
    );
    const r = turn(s, (_st, side) => (side === 0 ? { type: 'charged', index: 0 } : { type: 'fast' }), always);
    expect(r.state.sides[1].shields).toBe(0);
    expect(r.state.sides[1].hp).toBe(s.sides[1].hp - 1);
    expect(r.state.sides[1].buffs).toEqual([0, -2]);
  });

  it('applies a 10% buff deterministically on the 10th use', () => {
    let s = battle(med(['PSYCHIC']), { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM'] }, [0, 0]);
    const uses: number[] = [];
    for (let use = 1; use <= 10; use++) {
      const prepared = { ...s, sides: [{ ...s.sides[0], energy: 100, cooldownMs: 0 }, { ...s.sides[1], hp: 10_000 }] as const, chargedLastTurn: false };
      const r = resolveTurn(beginTurn(prepared), [{ type: 'charged', index: 0 }, null], never);
      if (r.events.some((e) => e.kind === 'buff')) uses.push(use);
      s = r.state;
    }
    expect(uses).toEqual([10]);
  });

  it('clamps stages at +4', () => {
    let s = battle(med(['POWER_UP_PUNCH']), azu);
    for (let i = 0; i < 6; i++) {
      const prepared = { ...s, sides: [{ ...s.sides[0], energy: 100, cooldownMs: 0 }, { ...s.sides[1], hp: 10_000 }] as const, chargedLastTurn: false };
      s = resolveTurn(beginTurn(prepared), [{ type: 'charged', index: 0 }, null], never).state;
    }
    expect(s.sides[0].buffs[0]).toBe(4);
  });
});
