import { describe, expect, it } from 'vitest';
import { defaultRosterEntry, opponentCard, typeReason } from '../src/companion';
import type { Combatant } from '../src/engine/combatant';
import { buildRosterCombatant } from '../src/matrix/teamMatrix';
import { testAppData } from './companionFixture';

const app = testAppData();
const mine = (id: string) => buildRosterCombatant(app.gd, defaultRosterEntry(app, id), 0);
const theirs = (id: string) => opponentCard(app, id).combatant!;
const melmetal = theirs('melmetal');

describe('typeReason', () => {
  it('explains a win despite a super-effective fast move', () => {
    expect(typeReason(mine('araquanid'), melmetal, 518)).toBe('Takes super-effective Thunder Shock, but resists both charged moves');
  });

  it('names the super-effective fast move on a loss', () => {
    expect(typeReason(mine('azumarill'), melmetal, 321)).toBe('Takes super-effective Thunder Shock');
  });

  it('says nothing when types are not misleading', () => {
    expect(typeReason(mine('medicham'), melmetal, 507)).toBeNull();
  });

  it('explains a loss despite resisting or taking neutral damage', () => {
    expect(typeReason(mine('medicham'), melmetal, 300)).toBe('Loses despite resisting or taking neutral damage: their bulk and pressure win');
  });

  it('lists only the resisted charged move when one is not resisted', () => {
    // Araquanid with Melmetal's moves swapped for one resisted and one neutral charged move.
    const opp: Combatant = { ...melmetal, chargedMoves: [melmetal.chargedMoves[0]!, app.gd.moves.get('HYPER_BEAM') as Combatant['chargedMoves'][number]] };
    expect(typeReason(mine('araquanid'), opp, 600)).toBe('Takes super-effective Thunder Shock, but resists Double Iron Bash');
  });

  it('falls back to bulk and pressure when nothing is resisted', () => {
    const opp: Combatant = { ...melmetal, chargedMoves: [app.gd.moves.get('HYPER_BEAM') as Combatant['chargedMoves'][number]] };
    expect(typeReason(mine('araquanid'), opp, 600)).toBe('Takes super-effective Thunder Shock, but wins on bulk and pressure');
  });
});
