import type { ScriptedCharged } from '../../src/policy/testPolicies';

export interface OracleMon { speciesId: string; moveset: string[] }
export interface PvpokeRequest {
  a: OracleMon; b: OracleMon; shields: [number, number];
  mode: 'default' | 'fastOnly' | 'scripted'; script?: ScriptedCharged[];
}
export interface PvpokeEvent { turn: number; side: 0 | 1; type: string; name: string; damage: number }
export interface PvpokeResult { ratings: [number, number]; hp: [number, number]; events: PvpokeEvent[] }
export interface PvpokeHarness { simulate(req: PvpokeRequest): PvpokeResult }
export function createPvpoke(srcDir: string): PvpokeHarness;
