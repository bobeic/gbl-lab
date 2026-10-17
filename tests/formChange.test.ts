import { describe, expect, it } from 'vitest';
import { loadDefaultGameData } from '../src/data/node';
import type { Move } from '../src/data/types';
import { buildCombatant, moveDamage, type CombatantSpec } from '../src/engine/combatant';
import { activeCombatant, createBattle, type BattleState, type Side, type SideState } from '../src/engine/state';
import { beginTurn, canAct, resolveTurn, type Action, type BattleEvent, type ShieldDecider } from '../src/engine/turn';

const gd = loadDefaultGameData();
const rules = { maxBuffStages: gd.maxBuffStages, buffDivisor: gd.buffDivisor };
const mimikyu: CombatantSpec = { speciesId: 'mimikyu', fastMoveId: 'SHADOW_CLAW', chargedMoveIds: ['SHADOW_SNEAK', 'PLAY_ROUGH'] };
const morpeko: CombatantSpec = { speciesId: 'morpeko_full_belly', fastMoveId: 'THUNDER_SHOCK', chargedMoveIds: ['AURA_WHEEL_ELECTRIC', 'PSYCHIC_FANGS'] };
const azu: CombatantSpec = { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM', 'PLAY_ROUGH'] };
const med: CombatantSpec = { speciesId: 'medicham', fastMoveId: 'COUNTER', chargedMoveIds: ['ICE_PUNCH', 'PSYCHIC'] };

const never: ShieldDecider = () => false;
const always: ShieldDecider = () => true;
const charged = (index: number): Action => ({ type: 'charged', index });
const move = (id: string): Move => gd.moves.get(id)!;

function battle(a: CombatantSpec, b: CombatantSpec, shields: [number, number], startEnergy: [number, number]): BattleState {
  return createBattle([buildCombatant(gd, a), buildCombatant(gd, b)], { shields, startEnergy }, rules);
}

/** Overwrite fields of one side's state (for setting up a position directly). */
function patch(s: BattleState, side: Side, fields: Partial<SideState>): BattleState {
  const sides: [SideState, SideState] = [s.sides[0], s.sides[1]];
  sides[side] = { ...sides[side], ...fields };
  return { ...s, sides };
}

/** Resolve one turn with fixed actions for the sides that can act. */
function turn(s: BattleState, actions: [Action | null, Action | null], shield: ShieldDecider = never) {
  const pre = beginTurn(s);
  const allowed = ([0, 1] as const).map((side) => (canAct(pre, side) ? actions[side] : null)) as [Action | null, Action | null];
  return resolveTurn(pre, allowed, shield);
}

const notFast = (events: readonly BattleEvent[]) => events.filter((e) => e.kind !== 'fast');

describe("Mimikyu's Disguise", () => {
  it('holds the first unshielded charged move to 1 damage, then busts with -1 Defense', () => {
    const s = battle(azu, mimikyu, [0, 0], [60, 0]);
    const blocked = moveDamage(activeCombatant(s, 0), 0, activeCombatant(s, 1), 0, move('PLAY_ROUGH'), rules.buffDivisor);
    const r = turn(s, [charged(1), null]);
    expect(r.state.sides[1].hp).toBe(s.sides[1].hp - 1);
    expect(notFast(r.events)).toEqual([
      { kind: 'charged', turn: 1, side: 0, moveId: 'PLAY_ROUGH', damage: 1, shielded: false },
      { kind: 'disguise', turn: 1, side: 1, blockedDamage: blocked, sourceMoveId: 'PLAY_ROUGH' },
      { kind: 'formChange', turn: 1, side: 1, from: 'mimikyu', to: 'mimikyu_busted' },
    ]);
    expect(r.state.sides[1].formId).toBe('mimikyu_busted');
    expect(r.state.sides[1].buffs).toEqual([0, -1]);
  });

  it('stays disguised when the hit is shielded', () => {
    const r = turn(battle(azu, mimikyu, [0, 1], [60, 0]), [charged(1), null], always);
    expect(r.state.sides[1].formId).toBe('mimikyu');
    expect(r.state.sides[1].shields).toBe(0);
    expect(r.state.sides[1].buffs).toEqual([0, 0]);
    expect(r.events.some((e) => e.kind === 'disguise' || e.kind === 'formChange')).toBe(false);
  });

  it('is not broken by fast moves', () => {
    let s = battle(azu, mimikyu, [0, 0], [0, 0]);
    for (let i = 0; i < 9; i++) s = turn(s, [{ type: 'fast' }, null]).state;
    expect(s.sides[1].hp).toBeLessThan(s.combatants[1].stats.hp);
    expect(s.sides[1].formId).toBe('mimikyu');
  });

  it('blocks only once: the next charged move hits busted Mimikyu in full', () => {
    let s = turn(battle(azu, mimikyu, [0, 0], [60, 0]), [charged(1), null]).state;
    s = turn(s, [null, null]).state; // no actions on the turn after a charged move
    s = patch(s, 0, { energy: 60 });
    const full = moveDamage(activeCombatant(s, 0), 0, activeCombatant(s, 1), -1, move('PLAY_ROUGH'), rules.buffDivisor);
    const r = turn(s, [charged(1), null]);
    expect(notFast(r.events)).toEqual([{ kind: 'charged', turn: 3, side: 0, moveId: 'PLAY_ROUGH', damage: full, shielded: false }]);
  });

  it('still deals 1 damage, so a Mimikyu on 1 HP faints', () => {
    const r = turn(patch(battle(azu, mimikyu, [0, 0], [60, 0]), 1, { hp: 1 }), [charged(1), null]);
    expect(r.state.sides[1].hp).toBe(0);
    expect(r.state.over).toBe(true);
    expect(r.events.at(-1)).toEqual({ kind: 'faint', turn: 1, side: 1 });
  });

  it('clamps the bust Defense drop at the stage limit', () => {
    const r = turn(patch(battle(azu, mimikyu, [0, 0], [60, 0]), 1, { buffs: [0, -rules.maxBuffStages] }), [charged(1), null]);
    expect(r.state.sides[1].buffs).toEqual([0, -rules.maxBuffStages]);
  });

  it("blocks the opponent's move when both throw on the same turn, and Mimikyu's own move lands in full", () => {
    const s = battle(azu, mimikyu, [0, 0], [60, 50]);
    const sneak = moveDamage(activeCombatant(s, 1), 0, activeCombatant(s, 0), 0, move('SHADOW_SNEAK'), rules.buffDivisor);
    const r = turn(s, [charged(1), charged(0)]);
    const disguises = r.events.filter((e) => e.kind === 'disguise');
    expect(disguises).toHaveLength(1);
    expect(disguises[0]).toMatchObject({ side: 1, sourceMoveId: 'PLAY_ROUGH' });
    expect(r.state.sides[0].hp).toBe(s.sides[0].hp - sneak);
    expect(r.state.sides[1].formId).toBe('mimikyu_busted');
  });
});

describe("Morpeko's Hunger Switch", () => {
  /** Throw each charged slot in turn from full energy and HP, recording the move used and the form afterwards. */
  function throwSequence(slots: number[], shield: ShieldDecider = never, shields: [number, number] = [0, 0]) {
    let s = battle(morpeko, azu, shields, [0, 0]);
    const used: string[] = [];
    const forms: string[] = [];
    const states: BattleState[] = [];
    for (const index of slots) {
      s = patch(patch(s, 0, { energy: 100 }), 1, { hp: s.combatants[1].stats.hp });
      const r = turn(s, [charged(index), null], shield);
      used.push(...r.events.flatMap((e) => (e.kind === 'charged' ? [e.moveId] : [])));
      s = turn(r.state, [null, null]).state;
      forms.push(s.sides[0].formId);
      states.push(s);
    }
    return { used, forms, states };
  }

  it('switches form after every charged move, with Aura Wheel following the form', () => {
    const { used, forms } = throwSequence([0, 0, 1, 0]);
    expect(used).toEqual(['AURA_WHEEL_ELECTRIC', 'AURA_WHEEL_DARK', 'PSYCHIC_FANGS', 'AURA_WHEEL_DARK']);
    expect(forms).toEqual(['morpeko_hangry', 'morpeko_full_belly', 'morpeko_hangry', 'morpeko_full_belly']);
  });

  it('logs each switch as a formChange event after the move and its buff', () => {
    const r = turn(battle(morpeko, azu, [0, 0], [45, 0]), [charged(0), null]);
    expect(notFast(r.events).map((e) => e.kind)).toEqual(['charged', 'buff', 'formChange']);
    expect(r.events.find((e) => e.kind === 'formChange')).toEqual({ kind: 'formChange', turn: 1, side: 0, from: 'morpeko_full_belly', to: 'morpeko_hangry' });
  });

  it('switches even when the charged move is shielded', () => {
    const { forms } = throwSequence([0], always, [0, 2]);
    expect(forms).toEqual(['morpeko_hangry']);
  });

  it("stacks Aura Wheel's +1 Attack across switches", () => {
    const { states } = throwSequence([0, 0]);
    expect(states[1]!.sides[0].buffs).toEqual([2, 0]);
  });

  it("deals damage with the active form's Aura Wheel type", () => {
    const { states } = throwSequence([0]);
    const s = patch(states[0]!, 0, { energy: 100 });
    const dark = moveDamage(activeCombatant(s, 0), s.sides[0].buffs[0], activeCombatant(s, 1), 0, move('AURA_WHEEL_DARK'), rules.buffDivisor);
    const electric = moveDamage(activeCombatant(s, 0), s.sides[0].buffs[0], activeCombatant(s, 1), 0, move('AURA_WHEEL_ELECTRIC'), rules.buffDivisor);
    expect(dark).not.toBe(electric);
    const r = turn(s, [charged(0), null]);
    expect(r.events.find((e) => e.kind === 'charged')).toMatchObject({ moveId: 'AURA_WHEEL_DARK', damage: dark });
  });

  it('recomputes its remembered move damage and move-order basis on each switch (PvPoke resetMoves)', () => {
    const { states } = throwSequence([0]);
    const s = states[0]!;
    const me = activeCombatant(s, 0);
    const opp = activeCombatant(s, 1);
    const expected = me.chargedMoves.map((m) => moveDamage(me, s.sides[0].buffs[0], opp, s.sides[1].buffs[1], m, rules.buffDivisor));
    expect(s.sides[0].lastDamage.charged).toEqual(expected);
    expect(s.sides[0].moveOrderBasis).toEqual(expected);
  });
});

it('leaves ordinary Pokémon in their single form', () => {
  const r = turn(battle(med, azu, [0, 0], [40, 0]), [charged(0), null]);
  expect(r.state.sides[0].formId).toBe('medicham');
  expect(r.events.some((e) => e.kind === 'formChange')).toBe(false);
});

describe('Cramorant', () => {
  const cram: CombatantSpec = { speciesId: 'cramorant', fastMoveId: 'PECK', chargedMoveIds: ['DIVE', 'FLY'] };
  const gulpIds = (events: readonly BattleEvent[]) => events.filter((e) => e.kind === 'charged' && e.moveId.startsWith('GULP_MISSILE_'));
  /** Azumarill (side 1) throws Ice Beam at a Cramorant (side 0) in `formId`; only Azumarill shields. */
  function hitWhile(formId: string, fields: Partial<SideState> = {}, shieldAzu = false) {
    const s = patch(battle(cram, azu, [0, 1], [0, 100]), 0, { formId, ...fields });
    return { s, r: turn(s, [null, charged(0)], (_s, d) => d === 1 && shieldAzu) };
  }

  it('catches Arrokuda after Dive above half HP', () => {
    const r = turn(battle(cram, azu, [0, 0], [100, 0]), [charged(0), null]);
    expect(r.state.sides[0].formId).toBe('cramorant_gulping');
    expect(notFast(r.events).filter((e) => e.kind !== 'faint').at(-1)).toEqual({ kind: 'formChange', turn: 1, side: 0, from: 'cramorant', to: 'cramorant_gulping' });
  });

  it('catches Pikachu at exactly half HP or less', () => {
    const s = battle(cram, azu, [0, 0], [100, 0]);
    const r = turn(patch(s, 0, { hp: Math.floor(s.combatants[0].stats.hp / 2) }), [charged(0), null]);
    expect(r.state.sides[0].formId).toBe('cramorant_gorging');
  });

  it('catches prey even when Dive is shielded', () => {
    const r = turn(battle(cram, azu, [0, 1], [100, 0]), [charged(0), null], always);
    expect(r.state.sides[1].shields).toBe(0);
    expect(r.state.sides[0].formId).toBe('cramorant_gulping');
  });

  it('Fly does not change form', () => {
    const r = turn(battle(cram, azu, [0, 0], [100, 0]), [charged(1), null]);
    expect(r.state.sides[0].formId).toBe('cramorant');
    expect(r.events.some((e) => e.kind === 'formChange')).toBe(false);
  });

  it('Dive while holding prey keeps the form', () => {
    const r = turn(patch(battle(cram, azu, [0, 0], [100, 0]), 0, { formId: 'cramorant_gulping' }), [charged(0), null]);
    expect(r.state.sides[0].formId).toBe('cramorant_gulping');
    expect(r.events.some((e) => e.kind === 'formChange')).toBe(false);
  });

  it('an unshielded hit while gulping fires Arrokuda', () => {
    const { s, r } = hitWhile('cramorant_gulping');
    const azuHp = s.combatants[1].stats.hp;
    const gulp = Math.floor(0.15 * azuHp) + 1;
    expect(notFast(r.events)).toEqual([
      expect.objectContaining({ kind: 'charged', side: 1, moveId: 'ICE_BEAM', shielded: false }),
      { kind: 'charged', turn: 1, side: 0, moveId: 'GULP_MISSILE_ARROKUDA', damage: gulp, shielded: false },
      { kind: 'buff', turn: 1, side: 1, stages: [0, -1], sourceMoveId: 'GULP_MISSILE_ARROKUDA' },
      { kind: 'formChange', turn: 1, side: 0, from: 'cramorant_gulping', to: 'cramorant' },
    ]);
    expect(r.state.sides[1].hp).toBe(azuHp - gulp);
    expect(r.state.sides[1].shields).toBe(1);
    expect(r.state.sides[0].energy).toBe(s.sides[0].energy);
  });

  it('gorging fires Pikachu with -2 Attack', () => {
    const { r } = hitWhile('cramorant_gorging');
    expect(gulpIds(r.events)).toEqual([expect.objectContaining({ side: 0, moveId: 'GULP_MISSILE_PIKACHU' })]);
    expect(r.state.sides[1].buffs).toEqual([-2, 0]);
    expect(r.state.sides[0].formId).toBe('cramorant');
  });

  it('a shielded hit or a fast move does not trigger it', () => {
    const shieldedHit = (() => {
      const s = patch(battle(cram, azu, [1, 0], [0, 100]), 0, { formId: 'cramorant_gulping' });
      return turn(s, [null, charged(0)], always);
    })();
    expect(shieldedHit.events.find((e) => e.kind === 'charged')).toMatchObject({ moveId: 'ICE_BEAM', shielded: true });
    expect(gulpIds(shieldedHit.events)).toEqual([]);
    expect(shieldedHit.state.sides[0].formId).toBe('cramorant_gulping');
    let s = patch(battle(cram, azu, [0, 0], [0, 0]), 0, { formId: 'cramorant_gulping' });
    for (let i = 0; i < 3; i++) s = turn(s, [null, { type: 'fast' }]).state;
    expect(s.sides[0].hp).toBeLessThan(s.combatants[0].stats.hp);
    expect(s.sides[0].formId).toBe('cramorant_gulping');
  });

  it('fires even when the hit knocks Cramorant out', () => {
    const { s, r } = hitWhile('cramorant_gulping', { hp: 1 });
    const gulp = gulpIds(r.events);
    expect(gulp).toHaveLength(1);
    expect(r.state.sides[1].hp).toBe(s.sides[1].hp - (gulp[0] as { damage: number }).damage);
    expect(r.events).toContainEqual({ kind: 'faint', turn: 1, side: 0 });
  });

  it('resolves between two same-turn charged moves', () => {
    const s = patch(battle(cram, azu, [0, 0], [100, 100]), 0, { formId: 'cramorant_gulping' });
    expect(s.combatants[0].stats.atk).toBeGreaterThan(s.combatants[1].stats.atk); // Cramorant wins CMP
    const r = turn(s, [charged(1), charged(0)]);
    expect(r.events.flatMap((e) => (e.kind === 'charged' ? [`${e.side}:${e.moveId}`] : [])))
      .toEqual(['0:FLY', '1:ICE_BEAM', '0:GULP_MISSILE_ARROKUDA']);
  });

  it('a Cramorant mirror uses charged-move priority', () => {
    expect(battle(cram, cram, [0, 0], [0, 0]).usePriority).toBe(true);
  });

  it("a Gulp Missile is not answered by the opponent's Gulp Missile", () => {
    let s = battle(cram, cram, [0, 0], [100, 0]);
    s = patch(patch(s, 0, { formId: 'cramorant_gulping' }), 1, { formId: 'cramorant_gulping' });
    const r = turn(s, [charged(1), null]);
    expect(gulpIds(r.events)).toEqual([expect.objectContaining({ side: 1, moveId: 'GULP_MISSILE_ARROKUDA' })]);
    expect(r.state.sides[0].formId).toBe('cramorant_gulping');
    expect(r.state.sides[1].formId).toBe('cramorant');
  });

  it('a Surf moveset catches prey with Surf', () => {
    const surf: CombatantSpec = { speciesId: 'cramorant', fastMoveId: 'WATER_GUN', chargedMoveIds: ['SURF', 'HYDRO_PUMP'] };
    const r = turn(battle(surf, azu, [0, 0], [100, 0]), [charged(0), null]);
    expect(r.state.sides[0].formId).toBe('cramorant_gulping');
  });
});
