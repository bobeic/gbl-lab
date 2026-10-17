import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadDefaultGameData } from '../src/data/node';
import { buildCombatant, type PolicySettings } from '../src/engine/combatant';
import { createBattle, other, type BattleState, type Side, type SideState } from '../src/engine/state';
import { pvpokeShield, wouldShield } from '../src/policy/pvpoke/shield';

const gd = loadDefaultGameData();
const rules = { maxBuffStages: 4, buffDivisor: 4 };

// Expected values come from the PvPoke harness probe `shieldAt` (PvPoke's own Battle.useMove); see task-10 report.
// States mirror the engine's chooseShield snapshot: attacker energy already spent, lastDamage updated.
describe('pvpokeShield', () => {
  it('shields a normal charged move by default', () => {
    const st = createBattle([
      buildCombatant(gd, { speciesId: 'medicham', fastMoveId: 'COUNTER', chargedMoveIds: ['ICE_PUNCH'] }),
      buildCombatant(gd, { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM'] }),
    ], { shields: [1, 1], startEnergy: [0, 0] }, rules);
    expect(pvpokeShield(st, 1, 0, 20)).toBe(true);
    expect(wouldShield(st, 0, 1, st.combatants[0].chargedMoves[0]!).value).toBe(false);
  });

  it('defers to wouldShield for an early Power-Up Punch', () => {
    const st = createBattle([
      buildCombatant(gd, { speciesId: 'medicham', fastMoveId: 'COUNTER', chargedMoveIds: ['POWER_UP_PUNCH'] }),
      buildCombatant(gd, { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM'] }),
    ], { shields: [1, 1], startEnergy: [0, 0] }, rules);
    expect(pvpokeShield(st, 1, 0, 8)).toBe(false);
  });

  it('saves the shield against a shieldless attacker its Superpower cycle would KO (CMP turn counted)', () => {
    // Shadow Snorlax's best move is Superpower (defense-debuffing); Melmetal has no shields and wins CMP.
    const base = createBattle([
      buildCombatant(gd, { speciesId: 'melmetal', fastMoveId: 'THUNDER_SHOCK', chargedMoveIds: ['DOUBLE_IRON_BASH', 'DYNAMIC_PUNCH'] }),
      buildCombatant(gd, { speciesId: 'snorlax_shadow', fastMoveId: 'PSYWAVE', chargedMoveIds: ['BODY_SLAM', 'SUPER_POWER'] }),
    ], { shields: [0, 1], startEnergy: [0, 15] }, rules);
    const at = (hp: number): BattleState => ({ ...base, sides: [{ ...base.sides[0], hp }, base.sides[1]] });
    expect(pvpokeShield(at(10), 1, 0, 78)).toBe(false);
    expect(pvpokeShield(at(140), 1, 0, 78)).toBe(true);
  });

  it('defers to wouldShield for Obstruct (both-target buff)', () => {
    const base = createBattle([
      buildCombatant(gd, { speciesId: 'obstagoon', fastMoveId: 'COUNTER', chargedMoveIds: ['NIGHT_SLASH', 'OBSTRUCT'] }),
      buildCombatant(gd, { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM', 'PLAY_ROUGH'] }),
    ], { shields: [1, 1], startEnergy: [0, 0] }, rules);
    const at = (hp0: number, hp1: number): BattleState => ({
      ...base, sides: [{ ...base.sides[0], hp: hp0 }, { ...base.sides[1], hp: hp1 }],
    });
    expect(pvpokeShield(at(100, 187), 1, 1, 7)).toBe(false);
    expect(pvpokeShield(at(100, 30), 1, 1, 7)).toBe(true);
  });

  it('rejects a damage value that disagrees with the snapshot', () => {
    const st = createBattle([
      buildCombatant(gd, { speciesId: 'medicham', fastMoveId: 'COUNTER', chargedMoveIds: ['POWER_UP_PUNCH'] }),
      buildCombatant(gd, { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM'] }),
    ], { shields: [1, 1], startEnergy: [0, 0] }, rules);
    expect(() => pvpokeShield(st, 1, 0, 6)).toThrow(/damage/);
  });
});

interface Mon { speciesId: string; moveset: string[] }
/** [hp, energy, shields, atkStage, defStage, fastDamage, ...chargedDamage] */
type EncodedSide = number[];
/** [attacker, moveIndex, wouldShield, shielded, side0, side1] */
type EncodedDecision = [Side, number, 0 | 1, 0 | 1, EncodedSide, EncodedSide, [string, string]?];
interface TraceCase { a: number; b: number; shields: [number, number]; baitShields?: [0 | 1 | 2, 0 | 1 | 2]; decisions: EncodedDecision[] }
const fixture: { upstream: string; mons: Mon[]; cases: TraceCase[] } = JSON.parse(readFileSync('tests/fixtures/shield-oracle.json', 'utf8'));

const build = (m: Mon, baitShields: PolicySettings['baitShields'] | undefined) => buildCombatant(gd, {
  speciesId: m.speciesId, fastMoveId: m.moveset[0]!, chargedMoveIds: m.moveset.slice(1),
  ...(baitShields === undefined ? {} : { settings: { baitShields } }),
});

const decode = (base: SideState, e: EncodedSide): SideState => ({
  ...base, hp: e[0]!, energy: e[1]!, shields: e[2]!, buffs: [e[3]!, e[4]!], lastDamage: { fast: e[5]!, charged: e.slice(6) },
});

describe('pvpokeShield matches every shield decision PvPoke makes in default simulations', () => {
  it('was generated from the vendored PvPoke commit', () => {
    expect(fixture.upstream).toBe(readFileSync('data/UPSTREAM', 'utf8').trim());
    expect(fixture.cases.length).toBeGreaterThan(0);
  });

  it('wouldShield value and final shield decision', () => {
    const mismatches: string[] = [];
    let n = 0;
    for (const c of fixture.cases) {
      const a = fixture.mons[c.a]!;
      const b = fixture.mons[c.b]!;
      const start = createBattle([build(a, c.baitShields?.[0]), build(b, c.baitShields?.[1])], { shields: c.shields }, rules);
      for (const [attacker, moveIndex, ws, shielded, s0, s1, forms] of c.decisions) {
        n++;
        const [f0, f1] = forms ?? [start.sides[0].formId, start.sides[1].formId];
        const st: BattleState = { ...start, sides: [{ ...decode(start.sides[0], s0), formId: f0 }, { ...decode(start.sides[1], s1), formId: f1 }] };
        const defender = other(attacker);
        const move = st.combatants[attacker].chargedMoves[moveIndex]!;
        const damage = st.sides[attacker].lastDamage.charged[moveIndex]!;
        const oursWould = wouldShield(st, attacker, defender, move).value;
        const ours = pvpokeShield(st, defender, moveIndex, damage);
        if (oursWould !== (ws === 1) || ours !== (shielded === 1)) {
          mismatches.push(`${a.speciesId} vs ${b.speciesId} ${JSON.stringify(c.shields)} bait ${JSON.stringify(c.baitShields)} `
            + `${move.id} by ${attacker}: would ours ${oursWould} pvpoke ${ws}, shield ours ${ours} pvpoke ${shielded}`);
        }
      }
    }
    expect(n).toBeGreaterThan(10000);
    expect(mismatches.slice(0, 10)).toEqual([]);
  });
});

describe('PvPoke Cramorant shield branches (ActionLogic.js:1244-1257, Battle.js:1127-1137)', () => {
  const azu = { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM', 'PLAY_ROUGH'] };
  const cramSpec = (chargedMoveIds = ['DIVE', 'FLY']) => ({ speciesId: 'cramorant', fastMoveId: 'PECK', chargedMoveIds });
  const bait: Partial<PolicySettings> = { baitShields: 2 }; // PvPoke shields every move from an always-baiting attacker
  const withSide = (s: BattleState, side: Side, fields: Partial<SideState>): BattleState => {
    const sides: [SideState, SideState] = [s.sides[0], s.sides[1]];
    sides[side] = { ...sides[side], ...fields };
    return { ...s, sides };
  };
  /** Azumarill (side 0) attacks Cramorant (side 1) in `formId`. */
  const azuHitsCram = (formId: string, settings: Partial<PolicySettings> = {}) => withSide(createBattle(
    [buildCombatant(gd, { ...azu, settings }), buildCombatant(gd, cramSpec())], { shields: [1, 1], startEnergy: [0, 0] }, rules), 1, { formId });
  /** Cramorant (side 0) attacks Azumarill (side 1) at `hp`. */
  const cramHitsAzu = (hp: number | null, settings: Partial<PolicySettings> = bait, moves?: string[]) => {
    const s = createBattle([buildCombatant(gd, { ...cramSpec(moves), settings }), buildCombatant(gd, azu)], { shields: [1, 1], startEnergy: [0, 0] }, rules);
    return hp === null ? s : withSide(s, 1, { hp });
  };
  const dmg = (s: BattleState, side: Side, i: number) => s.sides[side].lastDamage.charged[i]!;

  it('a gulping Cramorant lets a weak move through', () => {
    const iceBeam = (s: BattleState) => s.combatants[0].chargedMoves[0]!;
    const plain = azuHitsCram('cramorant', bait);
    expect(dmg(plain, 0, 0) * 2.2).toBeLessThan(plain.sides[1].hp);
    expect(wouldShield(plain, 0, 1, iceBeam(plain)).value).toBe(true);
    const gulping = azuHitsCram('cramorant_gulping', bait);
    expect(wouldShield(gulping, 0, 1, iceBeam(gulping)).value).toBe(false);
    expect(wouldShield(azuHitsCram('cramorant_gorging', bait), 0, 1, iceBeam(gulping)).value).toBe(false);
  });

  it('a move from Cramorant under a third of HP is not shielded', () => {
    const full = cramHitsAzu(null);
    const fly = full.combatants[0].chargedMoves[1]!;
    expect(dmg(full, 0, 1) / full.sides[1].hp).toBeLessThan(0.33);
    expect(wouldShield(full, 0, 1, fly).value).toBe(false);
    expect(wouldShield(cramHitsAzu(dmg(full, 0, 1) * 2), 0, 1, fly).value).toBe(true);
  });

  it("Cramorant's Dive is not shielded when it would KO anyway", () => {
    const d = dmg(cramHitsAzu(null), 0, 0);
    const dive = cramHitsAzu(null).combatants[0].chargedMoves[0]!;
    expect(wouldShield(cramHitsAzu(d), 0, 1, dive).value).toBe(true);
    expect(wouldShield(cramHitsAzu(d - 1), 0, 1, dive).value).toBe(false);
  });

  it('a KO-ing Surf is still shielded (PvPoke ActionLogic.js:1255 moveID typo)', () => {
    const s = cramHitsAzu(null, bait, ['SURF', 'FLY']);
    const surf = s.combatants[0].chargedMoves[0]!;
    expect(wouldShield(cramHitsAzu(dmg(s, 0, 0) - 1, bait, ['SURF', 'FLY']), 0, 1, surf).value).toBe(true);
  });

  it('in Battle.useMove, a gulping Cramorant defers to wouldShield against a weak move', () => {
    const plain = azuHitsCram('cramorant');
    expect(pvpokeShield(plain, 1, 0, dmg(plain, 0, 0))).toBe(true);
    const gulping = azuHitsCram('cramorant_gulping');
    expect(wouldShield(gulping, 0, 1, gulping.combatants[0].chargedMoves[0]!).value).toBe(false);
    expect(pvpokeShield(gulping, 1, 0, dmg(gulping, 0, 0))).toBe(false);
  });

  it("in Battle.useMove, Cramorant's move under a third of HP defers to wouldShield", () => {
    const full = cramHitsAzu(null, {});
    expect(pvpokeShield(full, 1, 1, dmg(full, 0, 1))).toBe(false);
    expect(pvpokeShield(cramHitsAzu(dmg(full, 0, 1) * 2, {}), 1, 1, dmg(full, 0, 1))).toBe(true);
  });
});
