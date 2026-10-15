import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { loadDefaultGameData } from '../src/data';
import { buildCombatant } from '../src/engine/combatant';
import { PvPokeLikePolicy } from '../src/policy/pvpoke';
import { runMatchup } from '../src/sim/runMatchup';
import type { OracleMon, PvpokeHarness } from '../scripts/oracle/harness';

const require = createRequire(import.meta.url);
const { createPvpoke } = require('../scripts/oracle/pvpokeHarness.cjs') as { createPvpoke: (d: string) => PvpokeHarness };
const pvpoke = createPvpoke('.cache/pvpoke/src');
const gd = loadDefaultGameData();

const CASES: [OracleMon, OracleMon, [number, number]][] = [
  [{ speciesId: 'medicham', moveset: ['COUNTER', 'ICE_PUNCH', 'PSYCHIC'] }, { speciesId: 'azumarill', moveset: ['BUBBLE', 'ICE_BEAM', 'PLAY_ROUGH'] }, [1, 1]],
  [{ speciesId: 'medicham', moveset: ['COUNTER', 'ICE_PUNCH', 'PSYCHIC'] }, { speciesId: 'azumarill', moveset: ['BUBBLE', 'ICE_BEAM', 'PLAY_ROUGH'] }, [0, 0]],
  [{ speciesId: 'melmetal', moveset: ['THUNDER_SHOCK', 'DOUBLE_IRON_BASH', 'DYNAMIC_PUNCH'] }, { speciesId: 'registeel', moveset: ['LOCK_ON', 'FOCUS_BLAST', 'ZAP_CANNON'] }, [0, 0]],
  [{ speciesId: 'medicham', moveset: ['COUNTER', 'POWER_UP_PUNCH', 'ICE_PUNCH'] }, { speciesId: 'medicham', moveset: ['COUNTER', 'POWER_UP_PUNCH', 'ICE_PUNCH'] }, [2, 2]],
  [{ speciesId: 'melmetal', moveset: ['THUNDER_SHOCK', 'SUPER_POWER', 'ROCK_SLIDE'] }, { speciesId: 'azumarill', moveset: ['BUBBLE', 'ICE_BEAM', 'PLAY_ROUGH'] }, [1, 1]],
];

const build = (m: OracleMon) => buildCombatant(gd, { speciesId: m.speciesId, fastMoveId: m.moveset[0]!, chargedMoveIds: m.moveset.slice(1) });

describe('PvPokeLikePolicy reproduces PvPoke decisions', () => {
  it('Medicham vs Azumarill 1-1 gives the spike result 324/675', () => {
    expect(pvpoke.simulate({ a: CASES[0]![0], b: CASES[0]![1], shields: [1, 1], mode: 'default' }).ratings).toEqual([324, 675]);
  });

  for (const [a, b, shields] of CASES) {
    it(`${a.speciesId} vs ${b.speciesId} ${shields.join('-')}`, () => {
      const expected = pvpoke.simulate({ a, b, shields, mode: 'default' });
      const r = runMatchup(gd, build(a), build(b), { shields, policies: [new PvPokeLikePolicy(), new PvPokeLikePolicy()] });
      const ours = r.events.filter((e) => e.kind === 'charged').map((e) => [e.turn, e.side]);
      const theirs = expected.events.filter((e) => e.type.startsWith('charged')).map((e) => [e.turn, e.side]);
      expect(ours).toEqual(theirs);
      expect(r.ratings).toEqual(expected.ratings);
    });
  }
});
