import { describe, expect, it } from 'vitest';
import { GameDataError } from '../src/errors';
import { cellFrom, type Cell } from '../src/matrix/cell';
import { metaRow, parseMatrixFile, type MatrixFile } from '../src/matrix/matrixData';
import { summarize } from '../src/matrix/summary';

const flat = (r: number): Cell => cellFrom(() => r);

describe('summarize', () => {
  it('averages per scenario (rounded) and counts wins >500 and losses <500; 500 is neither', () => {
    const s = summarize({ id: 'x', cells: [flat(700), flat(500), flat(301)] });
    expect(s.average).toEqual(flat(500)); // (700+500+301)/3 = 500.33
    expect(s.wins).toEqual(flat(1));
    expect(s.losses).toEqual(flat(1));
  });

  it('keeps scenarios separate', () => {
    const s = summarize({ id: 'x', cells: [cellFrom((sa, sb) => (sa > sb ? 800 : 200))] });
    expect(s.average[2][0]).toBe(800);
    expect(s.average[0][2]).toBe(200);
    expect(s.wins[1][0]).toBe(1);
    expect(s.losses[1][1]).toBe(1);
  });

  it('rejects a row with no opponents', () => {
    expect(() => summarize({ id: 'x', cells: [] })).toThrow(RangeError);
  });
});

const entry = (speciesId: string) => ({ speciesId, moveset: ['A', 'B'], ivs: { atk: 1, def: 2, hp: 3 }, level: 20, cp: 1499 });
const validFile = (): MatrixFile => ({
  upstream: 'a'.repeat(40),
  generatedWith: { metaSize: 2, policy: 'pvpoke', startEnergy: [0, 0] },
  meta: [entry('x'), entry('y')] as unknown as MatrixFile['meta'],
  excluded: [{ speciesId: 'z', reason: 'UnsupportedPokemonError: no' }],
  ratings: [[flat(500), flat(600)], [flat(400), flat(500)]],
});
const mutate = (f: (j: any) => void): unknown => {
  const j = JSON.parse(JSON.stringify(validFile()));
  f(j);
  return j;
};

describe('parseMatrixFile', () => {
  it('accepts a valid file', () => {
    expect(parseMatrixFile(JSON.parse(JSON.stringify(validFile())))).toEqual(validFile());
  });

  it.each([
    ['not an object', () => 5, /Matrix file: expected an object/],
    ['a bad upstream', () => mutate((j) => { j.upstream = 'abc'; }), /upstream/],
    ['a metaSize that disagrees with meta', () => mutate((j) => { j.generatedWith.metaSize = 3; }), /generatedWith\.metaSize/],
    ['a meta entry without moves', () => mutate((j) => { j.meta[1].moveset = ['A']; }), /meta\[1\]\.moveset/],
    ['a missing ratings row', () => mutate((j) => { j.ratings.pop(); }), /ratings: expected 2 rows/],
    ['a short ratings row', () => mutate((j) => { j.ratings[1].pop(); }), /ratings\[1\]: expected 2 cells/],
    ['a 2x3 cell', () => mutate((j) => { j.ratings[0][1].pop(); }), /ratings\[0\]\[1\]: expected a 3x3 array/],
    ['a rating above 1000', () => mutate((j) => { j.ratings[1][0][2][1] = 1001; }), /ratings\[1\]\[0\]\[2\]\[1\]: expected an integer 0-1000/],
    ['a fractional rating', () => mutate((j) => { j.ratings[0][0][0][0] = 1.5; }), /ratings\[0\]\[0\]\[0\]\[0\]/],
    ['excluded not an array', () => mutate((j) => { j.excluded = {}; }), /excluded/],
  ])('rejects %s with GameDataError naming the path', (_name, make, message) => {
    expect(() => parseMatrixFile(make())).toThrow(GameDataError);
    expect(() => parseMatrixFile(make())).toThrow(message);
  });
});

describe('metaRow', () => {
  it('returns a meta Pokémon\'s row', () => {
    expect(metaRow(validFile(), 'y')).toEqual({ id: 'y', cells: [flat(400), flat(500)] });
  });

  it('rejects a species not in the meta', () => {
    expect(() => metaRow(validFile(), 'bulbasaur')).toThrow(/bulbasaur is not in the matrix meta/);
  });
});
