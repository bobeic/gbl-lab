import type { ScriptedCharged } from '../../src/policy/testPolicies';

export interface OracleMon { speciesId: string; moveset: string[] }
export interface PvpokeRequest {
  a: OracleMon; b: OracleMon; shields: [number, number];
  mode: 'default' | 'fastOnly' | 'scripted'; script?: ScriptedCharged[];
}
export interface PvpokeEvent { turn: number; side: 0 | 1; type: string; name: string; damage: number }
export interface PvpokeResult { ratings: [number, number]; hp: [number, number]; events: PvpokeEvent[] }

/** One charged move's state after PvPoke's Pokemon.resetMoves at Battle.start. */
export interface PvpokeChargedInfo { id: string; damage: number; dpe: number; selfDebuffing: boolean; hasBuffs: boolean }
/** PvPoke's move ordering for one side after Battle.start. */
export interface PvpokeMoveMeta { active: string[]; best: string | null; fastest: string | null; charged: PvpokeChargedInfo[] }
export interface MoveMetaRequest { a: OracleMon; b: OracleMon }

/** One side's state as ActionLogic.wouldShield sees it inside Battle.useMove. */
export interface PvpokeSideSnapshot {
  hp: number; energy: number; shields: number; buffs: [number, number];
  fastDamage: number; chargedDamage: number[];
}
/** A shield decision PvPoke made during a default simulation. */
export interface PvpokeShieldDecision {
  turn: number; attacker: 0 | 1; moveIndex: number;
  sides: [PvpokeSideSnapshot, PvpokeSideSnapshot];
  wouldShield: boolean; shielded: boolean;
}
export interface ShieldTraceRequest { a: OracleMon; b: OracleMon; shields: [number, number]; baitShields?: [0 | 1 | 2, 0 | 1 | 2] }

/** A hand-built pre-move state: `energy` is before the attacker pays for the move. */
export interface ShieldAtRequest {
  a: OracleMon; b: OracleMon; shields: [number, number]; baitShields?: [0 | 1 | 2, 0 | 1 | 2];
  attacker: 0 | 1; moveIndex: number; energy: [number, number];
  hp?: [number, number]; buffs?: [[number, number], [number, number]];
}
/** PvPoke's own shield decision for one hand-built state, with the state wouldShield saw. */
export interface PvpokeShieldAt { damage: number; sides: [PvpokeSideSnapshot, PvpokeSideSnapshot] | null; wouldShield: boolean | null; shielded: boolean }

/** Inputs to PvPoke's generateIVCombinations; `ivFloor` is passed through as PvPoke's own ivFloor argument. */
export interface IvCombinationsRequest {
  speciesId: string; cap: number; ivFloor?: number;
  /** Charged moves to equip before ranking (PvPoke's Return floor checks the equipped moves); default: PvPoke's initialize() pick. */
  chargedMoveIds?: string[];
}
/** One ranked IV combination as [atk, def, hp, level]. */
export type PvpokeIvCombination = [atk: number, def: number, hp: number, level: number];
/** PvPoke's IV ranking, best first, and the charged moves that were equipped when it was computed. */
export interface PvpokeIvRanking { chargedMoveIds: string[]; combinations: PvpokeIvCombination[] }

export interface PvpokeHarness {
  simulate(req: PvpokeRequest): PvpokeResult;
  /** Move ordering, best/fastest move and per-move damage/DPE for both sides. */
  moveMeta(req: MoveMetaRequest): [PvpokeMoveMeta, PvpokeMoveMeta];
  /** Every shield decision (defender had a shield, move not instant) in a default simulation. */
  shieldTrace(req: ShieldTraceRequest): PvpokeShieldDecision[];
  /** PvPoke's shield decision for one charged move from a hand-built state. */
  shieldAt(req: ShieldAtRequest): PvpokeShieldAt;
  /** PvPoke's IV ranking by stat product (Pokemon.generateIVCombinations('overall', 1, 4096)). */
  ivCombinations(req: IvCombinationsRequest): PvpokeIvRanking;
}
export function createPvpoke(srcDir: string): PvpokeHarness;
