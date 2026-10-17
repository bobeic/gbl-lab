import type { ChargedMove, StatPair } from '../data/types';
import { formOf, moveDamage, withForm, type Combatant, type Form } from './combatant';
import { MAX_ENERGY, MAX_SHIELDS } from './constants';
import { clampStage } from './damage';
import { BattleSetupError, IllegalActionError } from '../errors';

export type Side = 0 | 1;
export const SIDES: readonly Side[] = [0, 1];

/** Return the opposing side. */
export function other(side: Side): Side {
  return side === 0 ? 1 : 0;
}

/** The side's combatant in its active form: types and charged moves follow form changes. */
export function activeCombatant(state: BattleState, side: Side): Combatant {
  return withForm(state.combatants[side], state.sides[side].formId);
}

/** The side's active form, including the form-change rule in force. */
export function activeForm(state: BattleState, side: Side): Form {
  return formOf(state.combatants[side], state.sides[side].formId);
}

export interface SideState {
  readonly hp: number;
  readonly energy: number;
  readonly cooldownMs: number;
  readonly shields: number;
  readonly buffs: StatPair;
  readonly faintSource: 'none' | 'fast' | 'charged';
  /** PvPoke buffApplyMeter per charged move; null when the move has no chance-based buff. */
  readonly buffMeters: readonly (number | null)[];
  /** PvPoke's mutable move.damage: last computed damage per move, read by decision logic. */
  readonly lastDamage: { readonly fast: number; readonly charged: readonly number[] };
  /** Active form (PvPoke activeFormId); starts at the combatant's startFormId. */
  readonly formId: string;
  /** Per-slot charged damage when PvPoke's resetMoves last ran (battle start or a form change); the policy orders moves from it. */
  readonly moveOrderBasis: readonly number[];
}

/** A new PvPoke `move.damage` value for one charged move, written by decision logic rather than by using the move. */
export interface LastDamageUpdate {
  readonly side: Side;
  readonly chargedIndex: number;
  readonly damage: number;
}

/** Return the state with charged-move lastDamage values replaced, in order (PvPoke assigning move.damage). */
export function withLastDamage(state: BattleState, updates: readonly LastDamageUpdate[]): BattleState {
  if (updates.length === 0) return state;
  const charged: [number[], number[]] = [[...state.sides[0].lastDamage.charged], [...state.sides[1].lastDamage.charged]];
  for (const u of updates) {
    if (u.chargedIndex < 0 || u.chargedIndex >= charged[u.side].length) {
      throw new IllegalActionError(`Side ${u.side} has no charged move ${u.chargedIndex} to update`);
    }
    charged[u.side][u.chargedIndex] = u.damage;
  }
  const side = (i: Side): SideState => ({ ...state.sides[i], lastDamage: { ...state.sides[i].lastDamage, charged: charged[i] } });
  return { ...state, sides: [side(0), side(1)] };
}

export interface QueuedAction {
  readonly type: 'fast' | 'charged' | 'wait';
  readonly actor: Side;
  readonly turn: number;
  readonly chargedIndex: number;
  readonly priority: number;
  /** A charged move outside the slots (PvPoke extraChargedMovePool, e.g. Gulp Missile); chargedIndex is then -1. */
  readonly extraMove?: ChargedMove;
}

export interface BattleRules {
  readonly maxBuffStages: number;
  readonly buffDivisor: number;
}

export interface BattleState {
  readonly combatants: readonly [Combatant, Combatant];
  readonly sides: readonly [SideState, SideState];
  readonly rules: BattleRules;
  readonly turn: number;
  readonly queue: readonly QueuedAction[];
  readonly chargedLastTurn: boolean;
  readonly usePriority: boolean;
  readonly over: boolean;
}

export interface BattleSetup {
  readonly shields: readonly [number, number];
  readonly startEnergy?: readonly [number, number];
}

/** PvPoke's starting buffApplyMeter for a charged move's buff chance; null when the buff is certain or absent. */
export function initialMeter(chance: number | undefined): number | null {
  if (chance === undefined || chance >= 1) return null;
  // PvPoke Pokemon.resetMoves (Pokemon.js:740-746): 50% moves apply on the second use
  return chance === 0.5 ? 0 : chance;
}

function assertSetup(setup: BattleSetup): void {
  for (const side of SIDES) {
    const shields = setup.shields[side];
    if (!Number.isInteger(shields) || shields < 0 || shields > MAX_SHIELDS) {
      throw new BattleSetupError(`Side ${side} shields must be an integer 0-${MAX_SHIELDS}, got ${shields}`);
    }
    const energy = setup.startEnergy?.[side] ?? 0;
    if (!Number.isInteger(energy) || energy < 0 || energy > MAX_ENERGY) {
      throw new BattleSetupError(`Side ${side} start energy must be an integer 0-${MAX_ENERGY}, got ${energy}`);
    }
  }
}

/** Create the starting state of a 1v1 battle. */
export function createBattle(combatants: readonly [Combatant, Combatant], setup: BattleSetup, rules: BattleRules): BattleState {
  assertSetup(setup);
  const buffs = combatants.map((c) => [
    clampStage(c.species.nativeStatBuffs[0], rules.maxBuffStages),
    clampStage(c.species.nativeStatBuffs[1], rules.maxBuffStages),
  ] as const);

  const side = (i: Side): SideState => {
    const me = combatants[i];
    const opp = combatants[other(i)];
    const dmg = (move: Combatant['fastMove'] | Combatant['chargedMoves'][number]): number =>
      moveDamage(me, buffs[i]![0], opp, buffs[other(i)]![1], move, rules.buffDivisor);
    const charged = me.chargedMoves.map(dmg);
    return {
      hp: me.stats.hp,
      energy: setup.startEnergy?.[i] ?? 0,
      cooldownMs: 0,
      shields: setup.shields[i],
      buffs: buffs[i]!,
      faintSource: 'none',
      buffMeters: me.chargedMoves.map((m) => initialMeter(m.buffs?.chance)),
      lastDamage: { fast: dmg(me.fastMove), charged },
      formId: me.startFormId,
      moveOrderBasis: charged,
    };
  };

  return {
    combatants,
    sides: [side(0), side(1)],
    rules,
    turn: 1,
    queue: [],
    chargedLastTurn: false,
    // PvPoke Battle.js:255-258: also on in a Cramorant mirror
    usePriority: combatants[0].stats.atk !== combatants[1].stats.atk
      || (combatants[0].species.id === 'cramorant' && combatants[1].species.id === 'cramorant'),
    over: false,
  };
}
