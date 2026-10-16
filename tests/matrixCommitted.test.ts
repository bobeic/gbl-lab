import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadDefaultGameData } from '../src/data/node';
import { simulateCell } from '../src/matrix/cell';
import { metaRow, parseMatrixFile } from '../src/matrix/matrixData';
import { buildMeta, metaCombatant, type RankingRow } from '../src/matrix/meta';
import { teamMatrix } from '../src/matrix/teamMatrix';

const gd = loadDefaultGameData();
const file = parseMatrixFile(JSON.parse(readFileSync('data/matrix-1500.json', 'utf8')));
const rankings: RankingRow[] = JSON.parse(readFileSync('data/rankings-1500.json', 'utf8'));

describe('committed data/matrix-1500.json', () => {
  it('was built from the vendored PvPoke commit', () => {
    expect(file.upstream).toBe(readFileSync('data/UPSTREAM', 'utf8').trim());
  });

  it('holds the current 150-Pokémon meta', () => {
    expect(file.generatedWith.metaSize).toBe(150);
    const meta = buildMeta(gd, rankings, 150);
    expect(file.meta).toEqual(meta.entries);
    expect(file.excluded).toEqual(meta.excluded);
  });

  it('matches a fresh simulation on a fixed sample of 200 pairs', () => {
    // Every 113th ordered pair: 200 pairs spread over the matrix, including self-pairs 0 and 113.
    const n = file.meta.length;
    const cs = file.meta.map((m) => metaCombatant(gd, m));
    let selfPairs = 0;
    for (let k = 0; k < 200; k++) {
      const idx = k * 113;
      const i = Math.floor(idx / n);
      const j = idx % n;
      if (i === j) selfPairs++;
      expect(file.ratings[i]![j], `${file.meta[i]!.speciesId} vs ${file.meta[j]!.speciesId}`).toEqual(simulateCell(gd, cs[i]!, cs[j]!));
    }
    expect(selfPairs).toBe(2);
  });

  it.each(['melmetal', 'mimikyu', 'morpeko_full_belly'])('gives the same row for %s through teamMatrix as through the batch', (id) => {
    const m = file.meta.find((e) => e.speciesId === id)!;
    const [fastMoveId, ...chargedMoveIds] = m.moveset;
    const [row] = teamMatrix(gd, [{ speciesId: id, fastMoveId, chargedMoveIds, ivs: m.ivs, level: m.level }], file.meta);
    expect(row!.cells).toEqual(metaRow(file, id).cells);
  });
});
