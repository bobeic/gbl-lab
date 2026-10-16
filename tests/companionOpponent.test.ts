import { describe, expect, it } from 'vitest';
import { defaultRosterEntry, opponentCard } from '../src/companion';
import { GameDataError, RosterError } from '../src/errors';
import { buildRosterCombatant } from '../src/matrix/teamMatrix';
import { testAppData } from './companionFixture';

const app = testAppData();

describe('opponentCard', () => {
  it('describes a supported opponent with its counts and a combatant', () => {
    const card = opponentCard(app, 'melmetal');
    expect(card.name).toBe('Melmetal');
    expect(card.types).toEqual(['steel']);
    expect(card.fast).toMatchObject({ id: 'THUNDER_SHOCK', name: 'Thunder Shock', type: 'electric', energyGain: 9, turns: 2 });
    expect(card.charged.map((c) => [c.id, c.counts])).toEqual([['DOUBLE_IRON_BASH', [4, 4, 4]], ['DYNAMIC_PUNCH', [5, 5, 5]]]);
    expect(card.combatant).not.toBeNull();
    expect(card.unsupportedReason).toBeNull();
  });

  it('keeps moves and counts for an unsupported opponent', () => {
    const card = opponentCard(app, 'cramorant');
    expect(card.combatant).toBeNull();
    expect(card.unsupportedReason).toMatch(/^UnsupportedPokemonError: /);
    expect(card.fast.id).toBe('PECK');
    expect(card.charged).toHaveLength(2);
    expect(card.charged[0]!.counts).toHaveLength(3);
  });

  it('rejects an unknown or unranked id', () => {
    expect(() => opponentCard(app, 'not_a_mon')).toThrow(GameDataError);
  });
});

describe('roster combatants', () => {
  it('names the entry when a move is misspelt', () => {
    const entry = { speciesId: 'medicham', fastMoveId: 'PSYCHO_CUTT', chargedMoveIds: ['ICE_PUNCH'], label: 'My Cham' };
    expect(() => buildRosterCombatant(app.gd, entry, 1)).toThrow(RosterError);
    expect(() => buildRosterCombatant(app.gd, entry, 1)).toThrow(/Roster entry 1 \(My Cham\)/);
  });

  it('defaults a roster entry to the ranking moveset', () => {
    expect(defaultRosterEntry(app, 'medicham')).toEqual({
      speciesId: 'medicham', fastMoveId: 'PSYCHO_CUT', chargedMoveIds: ['ICE_PUNCH', 'DYNAMIC_PUNCH'],
    });
  });
});
