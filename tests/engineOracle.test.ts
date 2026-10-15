import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadDefaultGameData } from '../src/data/node';
import { buildCombatant } from '../src/engine/combatant';
import { FastOnlyPolicy, ScriptedPolicy, type ScriptedCharged } from '../src/policy/testPolicies';
import { runMatchup } from '../src/sim/runMatchup';

interface Mon { speciesId: string; moveset: string[] }
interface Case { a: Mon; b: Mon; shields: [number, number]; mode: 'fastOnly' | 'scripted'; script?: ScriptedCharged[]; ratings: [number, number]; hp: [number, number] }

const gd = loadDefaultGameData();
const fixture: { upstream: string; cases: Case[] } = JSON.parse(readFileSync('tests/fixtures/engine-oracle.json', 'utf8'));
const EXPECTED_CASES = { fastOnly: 820, scripted: 400 } as const;
const build = (m: Mon) => buildCombatant(gd, { speciesId: m.speciesId, fastMoveId: m.moveset[0]!, chargedMoveIds: m.moveset.slice(1) });

describe('engine matches PvPoke exactly', () => {
  it('was generated from the vendored PvPoke commit', () => {
    expect(fixture.upstream).toBe(readFileSync('data/UPSTREAM', 'utf8').trim());
  });

  for (const mode of ['fastOnly', 'scripted'] as const) {
    it(`${mode}: identical ratings and HP for every case`, () => {
      const mismatches: string[] = [];
      const cases = fixture.cases.filter((x) => x.mode === mode);
      expect(cases).toHaveLength(EXPECTED_CASES[mode]);
      for (const c of cases) {
        const policy = mode === 'fastOnly' ? new FastOnlyPolicy() : new ScriptedPolicy(c.script!);
        const r = runMatchup(gd, build(c.a), build(c.b), { shields: c.shields, policies: [policy, policy] });
        if (r.ratings[0] !== c.ratings[0] || r.ratings[1] !== c.ratings[1] || r.hp[0] !== c.hp[0] || r.hp[1] !== c.hp[1]) {
          mismatches.push(`${c.a.speciesId} vs ${c.b.speciesId} ${JSON.stringify(c.shields)}: ours ${r.ratings} pvpoke ${c.ratings}`);
        }
      }
      expect(mismatches.slice(0, 10)).toEqual([]);
    });
  }
});
