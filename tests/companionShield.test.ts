import { describe, expect, it } from 'vitest';
import { defaultRosterEntry, ForcedFirstShieldPolicy, ForcedFirstThrowPolicy, opponentCard, SHIELD_CLOSE_MARGIN, shieldAdvice } from '../src/companion';
import { buildRosterCombatant } from '../src/matrix/teamMatrix';
import { PvPokeLikePolicy } from '../src/policy/pvpoke';
import { runMatchup } from '../src/sim/runMatchup';
import { testAppData } from './companionFixture';

const app = testAppData();
const mine = (id: string) => buildRosterCombatant(app.gd, defaultRosterEntry(app, id), 0);
const theirs = (id: string) => opponentCard(app, id).combatant!;
const araquanid = mine('araquanid');
const melmetal = theirs('melmetal');

function firstIncoming(forced: boolean) {
  const res = runMatchup(app.gd, araquanid, melmetal, { shields: [1, 1], policies: [new ForcedFirstShieldPolicy(forced), new PvPokeLikePolicy()] });
  return res.events.find((e) => e.kind === 'charged' && e.side === 1);
}

describe('ForcedFirstShieldPolicy', () => {
  it('lets the first incoming charged move through when forced false', () => {
    expect(firstIncoming(false)).toMatchObject({ shielded: false });
  });

  it('shields the first incoming charged move when forced true', () => {
    expect(firstIncoming(true)).toMatchObject({ shielded: true });
  });
});

describe('ForcedFirstThrowPolicy', () => {
  it('makes their first charged move the forced one, then plays like PvPoke', () => {
    const seismitoad = theirs('seismitoad');
    const first = (index: number) => runMatchup(app.gd, mine('melmetal'), seismitoad, {
      shields: [1, 2], policies: [new PvPokeLikePolicy(), new ForcedFirstThrowPolicy(index)],
    }).events.find((e) => e.kind === 'charged' && e.side === 1);
    expect(first(0)).toMatchObject({ moveId: 'EARTH_POWER' });
    expect(first(1)).toMatchObject({ moveId: 'ICY_WIND' });
  });
});

describe('shieldAdvice', () => {
  it('gives nothing when I have no shields', () => {
    expect(shieldAdvice(app.gd, araquanid, melmetal, [0, 2])).toEqual([]);
  });

  it('gives nothing when they never throw a charged move', () => {
    // Found by simulating default Medicham against the top 400 ranked species at 2-0 and keeping
    // those with no side-1 charged event: Bastiodon faints before reaching charged-move energy.
    expect(shieldAdvice(app.gd, mine('medicham'), theirs('bastiodon'), [2, 0])).toEqual([]);
  });

  it('advises each of their charged moves, so a held Earth Power is covered as well as the bait', () => {
    // The battle the user reported: Melmetal on 1 shield against Seismitoad on 2.
    const advice = shieldAdvice(app.gd, mine('melmetal'), theirs('seismitoad'), [1, 2]);
    expect(advice.map((a) => a.moveId)).toEqual(['EARTH_POWER', 'ICY_WIND']);
    const icyWind = advice[1]!;
    expect(icyWind).toMatchObject({ kind: 'let-through', shieldRating: 71, noShieldRating: 256, expectedFirst: true });
    for (const a of advice) {
      const expected = Math.abs(a.shieldRating - a.noShieldRating) <= SHIELD_CLOSE_MARGIN
        ? 'close'
        : a.shieldRating > a.noShieldRating ? 'shield' : 'let-through';
      expect(a.kind).toBe(expected);
    }
    expect(advice[0]!.expectedFirst).toBe(false);
  });
});
