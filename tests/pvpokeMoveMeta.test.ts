import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadDefaultGameData } from '../src/data';
import { buildCombatant } from '../src/engine/combatant';
import { createBattle, type Side } from '../src/engine/state';
import { orderChargedMoves } from '../src/policy/pvpoke/moveMeta';
import { views } from '../src/policy/pvpoke/view';

const gd = loadDefaultGameData();
const rules = { maxBuffStages: 4, buffDivisor: 4 };
const vs = (id: string, fast: string, charged: string[]) => {
  const me = buildCombatant(gd, { speciesId: id, fastMoveId: fast, chargedMoveIds: charged });
  const opp = buildCombatant(gd, { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM'] });
  const st = createBattle([me, opp], { shields: [1, 1] }, rules);
  return orderChargedMoves(me, st.sides[0], st.rules.buffDivisor);
};

// Expected values below come from the PvPoke harness probe `moveMeta` (see task-10 report).
describe('orderChargedMoves (PvPoke Pokemon.resetMoves)', () => {
  it('sorts by energy and picks the cheaper move as fastest', () => {
    const r = vs('medicham', 'COUNTER', ['PSYCHIC', 'ICE_PUNCH']);
    expect(r.fastest?.id).toBe('ICE_PUNCH');
    expect(r.best?.id).toBe('PSYCHIC');
    expect(r.active.map((m) => m.id)).toEqual(['ICE_PUNCH', 'PSYCHIC']);
  });

  it('prefers a close-energy self-buffing move as the bait (PUP)', () => {
    const r = vs('medicham', 'COUNTER', ['ICE_PUNCH', 'POWER_UP_PUNCH']);
    expect(r.active.map((m) => m.id)).toEqual(['POWER_UP_PUNCH', 'ICE_PUNCH']);
    expect(r.best?.id).toBe('POWER_UP_PUNCH');
  });

  it('applies the Zap Cannon Registeel clause', () => {
    const r = vs('registeel', 'LOCK_ON', ['FOCUS_BLAST', 'ZAP_CANNON']);
    expect(r.best?.id).toBe('ZAP_CANNON');
    expect(r.fastest?.id).toBe('FOCUS_BLAST');
    const focusBlast = r.active.find((m) => m.id === 'FOCUS_BLAST')!;
    expect(focusBlast.selfDebuffing).toBe(true);
    expect(focusBlast.buffs?.stages).toEqual([0, 0]);
  });

  it('favours Obstruct even after a cheaper, higher-DPE move overtook it (post-loop clause)', () => {
    const r = vs('obstagoon', 'COUNTER', ['CROSS_CHOP', 'OBSTRUCT']);
    expect(r.active.map((m) => m.id)).toEqual(['OBSTRUCT', 'CROSS_CHOP']);
    expect(r.best?.id).toBe('OBSTRUCT');
    expect(r.fastest?.id).toBe('CROSS_CHOP');
  });

  it('lets a much higher-DPE move beat Obstruct when Obstruct is not close enough', () => {
    const r = vs('obstagoon', 'COUNTER', ['OBSTRUCT', 'GUNK_SHOT']);
    expect(r.active.map((m) => m.id)).toEqual(['OBSTRUCT', 'GUNK_SHOT']);
    expect(r.best?.id).toBe('GUNK_SHOT');
  });
});

interface Mon { speciesId: string; moveset: string[] }
interface ChargedInfo { id: string; damage: number; dpe: number; selfDebuffing: boolean; hasBuffs: boolean }
interface Meta { active: string[]; best: string | null; fastest: string | null; charged: ChargedInfo[] }
const fixture: { mons: Mon[]; cases: { a: number; b: number; result: [Meta, Meta] }[] } =
  JSON.parse(readFileSync('tests/fixtures/move-meta-oracle.json', 'utf8'));
const build = (m: Mon) => buildCombatant(gd, { speciesId: m.speciesId, fastMoveId: m.moveset[0]!, chargedMoveIds: m.moveset.slice(1) });

describe('PvPoke move metadata matches the harness for every meta pair', () => {
  it('active order, best, fastest, flags and DPE', () => {
    const mismatches: string[] = [];
    for (const c of fixture.cases) {
      const a = fixture.mons[c.a]!;
      const b = fixture.mons[c.b]!;
      const st = createBattle([build(a), build(b)], { shields: [1, 1] }, rules);
      for (const side of [0, 1] as Side[]) {
        const { poke } = views(st, side);
        const ours: Meta = {
          active: poke.activeChargedMoves.map((m) => m.id),
          best: poke.bestChargedMove?.id ?? null,
          fastest: poke.fastestChargedMove?.id ?? null,
          charged: poke.chargedMoves.map((m) => ({
            id: m.id, damage: poke.damageOf(m), dpe: poke.dpeOf(m), selfDebuffing: m.selfDebuffing, hasBuffs: m.buffs !== undefined,
          })),
        };
        try {
          expect(ours).toEqual(c.result[side]);
        } catch {
          mismatches.push(`${a.speciesId} vs ${b.speciesId} side ${side}: ours ${JSON.stringify(ours)} pvpoke ${JSON.stringify(c.result[side])}`);
        }
      }
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
  });
});
