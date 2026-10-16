import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadDefaultGameData } from '../src/data/node';
import { buildCombatant } from '../src/engine/combatant';
import { RosterError } from '../src/errors';
import { simulateCell } from '../src/matrix/cell';
import { buildMeta, metaCombatant, type RankingRow } from '../src/matrix/meta';
import { parseRoster, teamMatrix, type RosterEntry } from '../src/matrix/teamMatrix';

const gd = loadDefaultGameData();
const rankings: RankingRow[] = JSON.parse(readFileSync('data/rankings-1500.json', 'utf8'));
const meta = buildMeta(gd, rankings, 3).entries;
const fromRankings = (id: string, extra: Partial<RosterEntry> = {}): RosterEntry => {
  const [fastMoveId, ...chargedMoveIds] = rankings.find((r) => r.speciesId === id)!.moveset;
  return { speciesId: id, fastMoveId: fastMoveId!, chargedMoveIds, ...extra };
};
const expectedRow = (entry: RosterEntry) => {
  const c = buildCombatant(gd, { speciesId: entry.speciesId, fastMoveId: entry.fastMoveId, chargedMoveIds: entry.chargedMoveIds, ivs: entry.ivs, level: entry.level });
  return meta.map((m) => simulateCell(gd, c, metaCombatant(gd, m)));
};

describe('teamMatrix', () => {
  it('simulates each roster Pokémon, with its own IVs, against every meta entry in order', () => {
    const mine = fromRankings('azumarill', { ivs: { atk: 0, def: 15, hp: 15 } });
    const rows = teamMatrix(gd, [mine], meta);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe('azumarill');
    expect(rows[0]!.cells).toEqual(expectedRow(mine));
  });

  it('uses the label as the row id', () => {
    expect(teamMatrix(gd, [fromRankings('azumarill', { label: 'Azu (mine)' })], meta)[0]!.id).toBe('Azu (mine)');
  });

  it('keeps two of the same species as separate rows in roster order', () => {
    const a = fromRankings('melmetal', { ivs: { atk: 0, def: 15, hp: 15 }, label: 'Mel A' });
    const b = fromRankings('melmetal', { ivs: { atk: 15, def: 15, hp: 15 }, label: 'Mel B' });
    const rows = teamMatrix(gd, [a, b], meta);
    expect(rows.map((r) => r.id)).toEqual(['Mel A', 'Mel B']);
    expect(rows[0]!.cells).toEqual(expectedRow(a));
    expect(rows[1]!.cells).toEqual(expectedRow(b));
  });

  it('accepts a Pokémon with only one charged move', () => {
    const one = fromRankings('azumarill', { chargedMoveIds: ['ICE_BEAM'] });
    expect(teamMatrix(gd, [one], meta)[0]!.cells).toEqual(expectedRow(one));
  });

  it('handles a shadow Pokémon', () => {
    const shadow = fromRankings('quagsire_shadow');
    expect(teamMatrix(gd, [shadow], meta)[0]!.cells).toEqual(expectedRow(shadow));
  });

  it('returns no rows for an empty roster', () => {
    expect(teamMatrix(gd, [], meta)).toEqual([]);
  });

  it.each([
    ['an unknown species', { speciesId: 'nope', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM'] }, /Unknown species nope/],
    ['an illegal move', { speciesId: 'azumarill', fastMoveId: 'COUNTER', chargedMoveIds: ['ICE_BEAM'] }, /cannot learn fast move COUNTER/],
    ['invalid IVs', { ...fromRankings('azumarill'), ivs: { atk: 16, def: 0, hp: 0 } }, /IVs must be integers 0-15/],
    ['CP over the cap', { ...fromRankings('melmetal'), level: 40 }, /over the 1500 cap/],
    ['a level that is not a half-level', { ...fromRankings('azumarill'), level: 20.3 }, /not a valid half-level/],
    ['an unsupported species', fromRankings('cramorant'), /cramorant/],
  ] as [string, RosterEntry, RegExp][])('rejects %s with a RosterError naming the entry', (_name, bad, message) => {
    const run = () => teamMatrix(gd, [fromRankings('azumarill'), bad], meta);
    expect(run).toThrow(RosterError);
    expect(run).toThrow(/^Roster entry 1 \(/);
    expect(run).toThrow(message);
  });
});

describe('parseRoster', () => {
  it('accepts a well-formed roster', () => {
    const json = [{ speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM', 'PLAY_ROUGH'], ivs: { atk: 0, def: 15, hp: 15 }, label: 'Azu' }];
    expect(parseRoster(json)).toEqual(json);
  });

  it.each([
    ['not an array', { speciesId: 'azumarill' }, /Roster must be a JSON array/],
    ['an entry without speciesId', [{ fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM'] }], /Roster entry 0: speciesId/],
    ['chargedMoveIds not a string array', [{ speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: 'ICE_BEAM' }], /Roster entry 0: chargedMoveIds/],
    ['ivs missing a stat', [{ ...fromRankings('azumarill'), ivs: { atk: 1, def: 2 } }], /Roster entry 0: ivs/],
    ['a non-numeric level', [{ ...fromRankings('azumarill'), level: '20' }], /Roster entry 0: level/],
  ])('rejects %s', (_name, json, message) => {
    expect(() => parseRoster(json)).toThrow(RosterError);
    expect(() => parseRoster(json)).toThrow(message);
  });
});
