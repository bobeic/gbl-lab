import { describe, expect, it } from 'vitest';
import { defaultRosterEntry, opponentCard, rankSlots, ratingAt, ratingBand, staySwitch, teamCells } from '../src/companion';
import { buildRosterCombatant } from '../src/matrix/teamMatrix';
import { testAppData } from './companionFixture';

const app = testAppData();
const team = ['araquanid', 'medicham', 'azumarill'].map((id, i) => buildRosterCombatant(app.gd, defaultRosterEntry(app, id), i));
const melmetal = opponentCard(app, 'melmetal').combatant!;
const f = false;
const t = true;

describe('teamCells / ratingAt', () => {
  const cells = teamCells(app.gd, team, melmetal);

  it('rates each team member against the opponent at the given shields', () => {
    expect(cells.map((c) => ratingAt(c, 1, 1))).toEqual([518, 507, 321]);
    expect(cells[0]).toEqual([[602, 373, 178], [687, 518, 428], [772, 610, 445]]);
  });

  it('reads [myShields][theirShields]', () => {
    expect(ratingAt(cells[0]!, 0, 2)).toBe(178);
    expect(ratingAt(cells[0]!, 2, 0)).toBe(772);
  });
});

describe('staySwitch', () => {
  it('suggests switching to the best teammate when losing by enough', () => {
    expect(staySwitch([445, 663, 294], 0, [f, f, f])).toEqual({ kind: 'switch', from: 0, to: 1, fromRating: 445, toRating: 663 });
  });

  it('stays when the margin is under 100', () => {
    expect(staySwitch([480, 560, 300], 0, [f, f, f])).toEqual({ kind: 'stay', slot: 0, rating: 480 });
  });

  it('stays when the only better teammate has fainted', () => {
    expect(staySwitch([400, 700, 300], 0, [f, t, f])).toEqual({ kind: 'stay', slot: 0, rating: 400 });
  });

  it('stays when winning', () => {
    expect(staySwitch([520, 900, 300], 0, [f, f, f]).kind).toBe('stay');
  });

  it('needs the target to reach 500', () => {
    expect(staySwitch([300, 499, 100], 0, [f, f, f]).kind).toBe('stay');
  });

  it('says nothing when nothing of mine is on the field', () => {
    expect(staySwitch([445, 663, 294], null, [f, f, f])).toEqual({ kind: 'none' });
    expect(staySwitch([445, 663, 294], 0, [t, f, f])).toEqual({ kind: 'none' });
  });
});

describe('rankSlots', () => {
  it('orders non-fainted slots best first', () => {
    expect(rankSlots([445, 663, 294], [f, f, t])).toEqual([1, 0]);
  });

  it('breaks ties by slot', () => {
    expect(rankSlots([500, 500, 500], [f, f, f])).toEqual([0, 1, 2]);
  });
});

describe('ratingBand', () => {
  it.each([[449, 'loss'], [450, 'close'], [550, 'close'], [551, 'win']] as const)('%i is %s', (r, band) => {
    expect(ratingBand(r)).toBe(band);
  });
});
