import { describe, expect, it } from 'vitest';
import { moveAdvice } from '../src/companion';
import { SUPER_EFFECTIVE } from '../src/data/typeChart';
import { buildCombatant, moveDamage } from '../src/engine/combatant';
import { testAppData } from './companionFixture';

const app = testAppData();
const thievul = buildCombatant(app.gd, { speciesId: 'thievul', fastMoveId: 'SUCKER_PUNCH', chargedMoveIds: ['NIGHT_SLASH', 'ICY_WIND'] });
const altaria = buildCombatant(app.gd, { speciesId: 'altaria', fastMoveId: 'DRAGON_BREATH', chargedMoveIds: ['MOONBLAST', 'FLAMETHROWER'] });

describe('moveAdvice', () => {
  const advice = moveAdvice(app.gd, thievul, altaria, [1, 1]);
  const [nightSlash, icyWind] = advice.moves;

  it('lists my charged moves in slot order with damage as a share of their HP', () => {
    expect(advice.moves.map((m) => m.id)).toEqual(['NIGHT_SLASH', 'ICY_WIND']);
    for (const m of advice.moves) {
      const move = thievul.chargedMoves.find((c) => c.id === m.id)!;
      expect(m.damage).toBe(moveDamage(thievul, 0, altaria, 0, move, app.gd.buffDivisor));
      expect(m.percent).toBe(Math.round((100 * m.damage) / altaria.stats.hp));
    }
  });

  it("gives my fast move's damage to them and their charged moves' damage to me", () => {
    const f = thievul.fastMove;
    expect(advice.fast).toMatchObject({ name: f.name, energyGain: f.energyGain, turns: f.turns, damage: moveDamage(thievul, 0, altaria, 0, f, app.gd.buffDivisor) });
    expect([...advice.theirs.keys()]).toEqual(['MOONBLAST', 'FLAMETHROWER']);
    const moonblast = advice.theirs.get('MOONBLAST')!;
    expect(moonblast.damage).toBe(moveDamage(altaria, 0, thievul, 0, altaria.chargedMoves[0]!, app.gd.buffDivisor));
    expect(moonblast.percent).toBe(Math.round((100 * moonblast.damage) / thievul.stats.hp));
  });

  it('explains the multipliers: STAB, double super effective, and side effects', () => {
    expect(nightSlash).toMatchObject({ stab: true, effectiveness: 1, effect: '13% chance: raises your Attack' });
    expect(icyWind).toMatchObject({ stab: false, effectiveness: SUPER_EFFECTIVE * SUPER_EFFECTIVE, effect: 'lowers their Attack' });
    expect(icyWind!.counts).toEqual([7, 6, 7]);
  });

  it("names the first move my side throws in the engine's battle", () => {
    expect(['NIGHT_SLASH', 'ICY_WIND']).toContain(advice.firstThrow);
  });
});
