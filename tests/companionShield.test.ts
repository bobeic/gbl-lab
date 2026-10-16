import { describe, expect, it } from 'vitest';
import { defaultRosterEntry, ForcedFirstShieldPolicy, opponentCard, SHIELD_CLOSE_MARGIN, shieldAdvice } from '../src/companion';
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

describe('shieldAdvice', () => {
  it('gives nothing when I have no shields', () => {
    expect(shieldAdvice(app.gd, araquanid, melmetal, [0, 2])).toEqual({ kind: 'none' });
  });

  it('gives nothing when they never throw a charged move', () => {
    // Found by simulating default Medicham against the top 400 ranked species at 2-0 and keeping
    // those with no side-1 charged event: Bastiodon faints before reaching charged-move energy.
    expect(shieldAdvice(app.gd, mine('medicham'), theirs('bastiodon'), [2, 0])).toEqual({ kind: 'none' });
  });

  it('compares shielding and not shielding their first charged move', () => {
    const advice = shieldAdvice(app.gd, araquanid, melmetal, [2, 2]);
    if (advice.kind === 'none') throw new Error('expected advice');
    const { shieldRating, noShieldRating } = advice;
    const expected = Math.abs(shieldRating - noShieldRating) <= SHIELD_CLOSE_MARGIN
      ? 'close'
      : shieldRating > noShieldRating ? 'shield' : 'let-through';
    expect(advice.kind).toBe(expected);
    expect(['DOUBLE_IRON_BASH', 'DYNAMIC_PUNCH']).toContain(advice.moveId);
    // Pinned after the first green run: both lines shield two of three Double Iron Bashes, so they end the same.
    expect([shieldRating, noShieldRating]).toEqual([445, 445]);
  });
});
