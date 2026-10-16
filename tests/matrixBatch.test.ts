import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatReport } from '../scripts/gen-matrix';
import { loadDefaultGameData } from '../src/data/node';
import { GameDataError } from '../src/errors';
import { buildMatrixFile, mirrorMismatches } from '../src/matrix/batch';
import { cellFrom, simulateCell } from '../src/matrix/cell';
import { parseMatrixFile, type MatrixFile } from '../src/matrix/matrixData';
import { buildMeta, metaCombatant, type RankingRow } from '../src/matrix/meta';

const gd = loadDefaultGameData();
const rankings: RankingRow[] = JSON.parse(readFileSync('data/rankings-1500.json', 'utf8'));
const upstream = readFileSync('data/UPSTREAM', 'utf8').trim();
const meta = buildMeta(gd, rankings, 4);

describe('buildMatrixFile', () => {
  const progress: number[] = [];
  const file = buildMatrixFile(gd, meta, upstream, (done) => progress.push(done));

  it('produces a valid file with every ordered pair, including self-pairs', () => {
    expect(parseMatrixFile(JSON.parse(JSON.stringify(file)))).toEqual(file);
    expect(file.generatedWith).toEqual({ metaSize: 4, policy: 'pvpoke', startEnergy: [0, 0] });
    expect(file.meta).toEqual(meta.entries);
    expect(file.excluded).toEqual(meta.excluded);
    const cs = meta.entries.map((e) => metaCombatant(gd, e));
    expect(file.ratings[2]![1]).toEqual(simulateCell(gd, cs[2]!, cs[1]!));
    expect(file.ratings[3]![3]).toEqual(simulateCell(gd, cs[3]!, cs[3]!));
  });

  it('reports progress once per row', () => {
    expect(progress).toEqual([1, 2, 3, 4]);
  });

  it('refuses an upstream that is not a commit SHA', () => {
    expect(() => buildMatrixFile(gd, meta, '')).toThrow(GameDataError);
    expect(() => buildMatrixFile(gd, meta, 'main')).toThrow(/data\/UPSTREAM must be a 40-character commit SHA/);
  });
});

describe('mirrorMismatches', () => {
  const two = (ab: number, ba: number): MatrixFile => ({
    upstream: 'a'.repeat(40),
    generatedWith: { metaSize: 2, policy: 'pvpoke', startEnergy: [0, 0] },
    meta: [{ speciesId: 'x' }, { speciesId: 'y' }] as unknown as MatrixFile['meta'],
    excluded: [],
    // x vs y is `ab` only at x=0 shields, y=2 shields; y vs x is `ba` only at y=2, x=0; all else 500.
    ratings: [
      [cellFrom(() => 500), cellFrom((sa, sb) => (sa === 0 && sb === 2 ? ab : 500))],
      [cellFrom((sa, sb) => (sa === 2 && sb === 0 ? ba : 500)), cellFrom(() => 500)],
    ],
  });

  it('pairs a[sa][sb] with b[sb][sa] and allows the 1-point floor gap', () => {
    expect(mirrorMismatches(two(700, 300))).toEqual([]);
    expect(mirrorMismatches(two(700, 299))).toEqual([]);
  });

  it('reports a pair that is off by more than the tolerance', () => {
    expect(mirrorMismatches(two(700, 250))).toEqual([{ a: 'x', b: 'y', shields: [0, 2], ab: 700, ba: 250 }]);
  });
});

describe('formatReport', () => {
  it('lists meta size, exclusions, timing and mismatch examples', () => {
    const file = buildMatrixFile(gd, buildMeta(gd, rankings, 1), upstream);
    const report = formatReport(
      { ...file, excluded: [{ speciesId: 'cramorant', reason: 'UnsupportedPokemonError: x' }] },
      [{ a: 'x', b: 'y', shields: [0, 2], ab: 700, ba: 250 }],
      61_000,
      '2026-10-16',
    );
    expect(report).toContain('# Matchup matrix report');
    expect(report).toContain('2026-10-16');
    expect(report).toContain('Meta size: 1');
    expect(report).toContain('cramorant: UnsupportedPokemonError: x');
    expect(report).toContain('61.0 s');
    expect(report).toContain('Mirror mismatches (off by more than 1): 1');
    expect(report).toContain('| x | y | 0-2 | 700 | 250 |');
  });
});
