import { describe, expect, it } from 'vitest';
import { loadDefaultGameData } from '../src/data/node';
import { buildCombatant } from '../src/engine/combatant';
import { PvPokeLikePolicy } from '../src/policy/pvpoke';
import { runMatchup } from '../src/sim/runMatchup';
import type { OracleMon } from '../scripts/oracle/harness';
import { loadPvpoke } from '../scripts/oracle/load';
import { createBattle, type BattleState, type Side, type SideState } from '../src/engine/state';
import { decide } from '../src/policy/pvpoke/decide';

const pvpoke = loadPvpoke();
const gd = loadDefaultGameData();

const CASES: [OracleMon, OracleMon, [number, number]][] = [
  [{ speciesId: 'medicham', moveset: ['COUNTER', 'ICE_PUNCH', 'PSYCHIC'] }, { speciesId: 'azumarill', moveset: ['BUBBLE', 'ICE_BEAM', 'PLAY_ROUGH'] }, [1, 1]],
  [{ speciesId: 'medicham', moveset: ['COUNTER', 'ICE_PUNCH', 'PSYCHIC'] }, { speciesId: 'azumarill', moveset: ['BUBBLE', 'ICE_BEAM', 'PLAY_ROUGH'] }, [0, 0]],
  [{ speciesId: 'melmetal', moveset: ['THUNDER_SHOCK', 'DOUBLE_IRON_BASH', 'DYNAMIC_PUNCH'] }, { speciesId: 'registeel', moveset: ['LOCK_ON', 'FOCUS_BLAST', 'ZAP_CANNON'] }, [0, 0]],
  [{ speciesId: 'medicham', moveset: ['COUNTER', 'POWER_UP_PUNCH', 'ICE_PUNCH'] }, { speciesId: 'medicham', moveset: ['COUNTER', 'POWER_UP_PUNCH', 'ICE_PUNCH'] }, [2, 2]],
  [{ speciesId: 'melmetal', moveset: ['THUNDER_SHOCK', 'SUPER_POWER', 'ROCK_SLIDE'] }, { speciesId: 'azumarill', moveset: ['BUBBLE', 'ICE_BEAM', 'PLAY_ROUGH'] }, [1, 1]],
  // These three diverge unless decideAction's move.damage writes persist across turns (protocol rule 3, spec §10).
  [{ speciesId: 'tinkaton', moveset: ['FAIRY_WIND', 'GIGATON_HAMMER', 'BULLDOZE'] }, { speciesId: 'snorlax_shadow', moveset: ['PSYWAVE', 'BODY_SLAM', 'SUPER_POWER'] }, [2, 2]],
  [{ speciesId: 'quagsire', moveset: ['MUD_SHOT', 'AQUA_TAIL', 'STONE_EDGE'] }, { speciesId: 'rillaboom', moveset: ['SCRATCH', 'DRUM_BEATING', 'EARTH_POWER'] }, [2, 2]],
  [{ speciesId: 'jellicent', moveset: ['HEX', 'SURF', 'SHADOW_BALL'] }, { speciesId: 'rillaboom', moveset: ['SCRATCH', 'DRUM_BEATING', 'EARTH_POWER'] }, [2, 1]],
  // Form changes (form-changes spec §4-§6): Mimikyu's Disguise, the opponent's "break the disguise" rule, Morpeko's switch.
  [{ speciesId: 'mimikyu', moveset: ['SHADOW_CLAW', 'SHADOW_SNEAK', 'PLAY_ROUGH'] }, { speciesId: 'azumarill', moveset: ['BUBBLE', 'ICE_BEAM', 'PLAY_ROUGH'] }, [0, 0]],
  [{ speciesId: 'azumarill', moveset: ['BUBBLE', 'ICE_BEAM', 'PLAY_ROUGH'] }, { speciesId: 'mimikyu', moveset: ['SHADOW_CLAW', 'SHADOW_SNEAK', 'PLAY_ROUGH'] }, [2, 0]],
  [{ speciesId: 'mimikyu', moveset: ['SHADOW_CLAW', 'SHADOW_SNEAK', 'PLAY_ROUGH'] }, { speciesId: 'medicham', moveset: ['COUNTER', 'ICE_PUNCH', 'PSYCHIC'] }, [1, 1]],
  [{ speciesId: 'morpeko_full_belly', moveset: ['THUNDER_SHOCK', 'AURA_WHEEL_ELECTRIC', 'PSYCHIC_FANGS'] }, { speciesId: 'azumarill', moveset: ['BUBBLE', 'ICE_BEAM', 'PLAY_ROUGH'] }, [0, 0]],
  [{ speciesId: 'morpeko_full_belly', moveset: ['THUNDER_SHOCK', 'AURA_WHEEL_ELECTRIC', 'PSYCHIC_FANGS'] }, { speciesId: 'medicham', moveset: ['COUNTER', 'ICE_PUNCH', 'PSYCHIC'] }, [1, 1]],
  [{ speciesId: 'morpeko_full_belly', moveset: ['THUNDER_SHOCK', 'AURA_WHEEL_ELECTRIC', 'PSYCHIC_FANGS'] }, { speciesId: 'mimikyu', moveset: ['SHADOW_CLAW', 'SHADOW_SNEAK', 'PLAY_ROUGH'] }, [1, 1]],
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

  it('records PvPoke logDecision messages only when tracing', () => {
    const [a, b, shields] = CASES[0]!;
    const traced = new PvPokeLikePolicy({ trace: true });
    const silent = new PvPokeLikePolicy();
    runMatchup(gd, build(a), build(b), { shields, policies: [traced, silent] });
    expect(traced.trace).toContain("turn 15 side 0: doesn't use Ice Punch because it wants to bait");
    expect(silent.trace).toEqual([]);
  });
});

describe("PvPoke ActionLogic.js:236-252: break the opponent's disguise", () => {
  const rules = { maxBuffStages: gd.maxBuffStages, buffDivisor: gd.buffDivisor };
  const azu = { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM', 'PLAY_ROUGH'] };
  const mim = { speciesId: 'mimikyu', fastMoveId: 'SHADOW_CLAW', chargedMoveIds: ['SHADOW_SNEAK', 'PLAY_ROUGH'] };
  const start = (mimikyuShields: number): BattleState =>
    createBattle([buildCombatant(gd, azu), buildCombatant(gd, mim)], { shields: [1, mimikyuShields], startEnergy: [55, 0] }, rules);
  const patch = (s: BattleState, side: Side, fields: Partial<SideState>): BattleState => {
    const sides: [SideState, SideState] = [s.sides[0], s.sides[1]];
    sides[side] = { ...sides[side], ...fields };
    return { ...s, sides };
  };
  const breaks = (s: BattleState): boolean => {
    const trace: string[] = [];
    decide(s, 0, trace);
    return trace.some((line) => line.includes("to break opponent's ability as soon as possible"));
  };

  it('throws the fastest charged move at a disguised Mimikyu with no shields', () => {
    const trace: string[] = [];
    const decision = decide(start(0), 0, trace);
    expect(trace).toContain("turn 1 side 0: uses Ice Beam to break opponent's ability as soon as possible.");
    expect(decision.action).toEqual({ type: 'charged', index: 0 });
  });

  it('does not fire while Mimikyu has a shield, or once it is busted', () => {
    expect(breaks(start(1))).toBe(false);
    expect(breaks(patch(start(0), 1, { formId: 'mimikyu_busted' }))).toBe(false);
  });
});
