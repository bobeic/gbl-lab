import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { entryKey, simulateRoster, type Diag } from '../src/companion';
import { loadDefaultGameData } from '../src/data/node';
import { buildCombatant } from '../src/engine/combatant';
import { simulateCell, simulateDiagonal } from '../src/matrix/cell';
import { buildMeta, type RankingRow } from '../src/matrix/meta';
import type { RosterEntry } from '../src/matrix/teamMatrix';

const gd = loadDefaultGameData();
const rankings = JSON.parse(readFileSync('data/rankings-1500.json', 'utf8')) as RankingRow[];
const meta = buildMeta(gd, rankings, 150).entries.slice(0, 3);

const medicham: RosterEntry = { speciesId: 'medicham', fastMoveId: 'COUNTER', chargedMoveIds: ['ICE_PUNCH', 'PSYCHIC'] };
const azumarill: RosterEntry = { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM', 'PLAY_ROUGH'] };
const aegislash: RosterEntry = { speciesId: 'aegislash_shield', fastMoveId: 'AEGISLASH_CHARGE_PSYCHO_CUT', chargedMoveIds: ['SHADOW_BALL', 'GYRO_BALL'] };

describe('simulateDiagonal', () => {
  it("matches simulateCell's diagonal", () => {
    const a = buildCombatant(gd, medicham);
    const b = buildCombatant(gd, azumarill);
    const cell = simulateCell(gd, a, b);
    expect(simulateDiagonal(gd, a, b)).toEqual([cell[0][0], cell[1][1], cell[2][2]]);
  });
});

describe('simulateRoster', () => {
  it('simulates each usable entry against the meta and records dex', () => {
    const { candidates, skipped } = simulateRoster(gd, [medicham, azumarill], meta, new Map());
    expect(skipped).toEqual([]);
    expect(candidates.map((c) => c.index)).toEqual([0, 1]);
    expect(candidates.map((c) => c.dex)).toEqual([308, 184]);
    for (const c of candidates) expect(c.ratings.length).toBe(3);
  });

  it('skips unsupported entries and names them', () => {
    const { candidates, skipped } = simulateRoster(gd, [medicham, aegislash, azumarill], meta, new Map());
    expect(candidates.map((c) => c.index)).toEqual([0, 2]);
    expect(skipped[0]!.name).toBe('aegislash_shield');
    expect(skipped[0]!.reason).not.toBe('');
    const labelled = simulateRoster(gd, [{ ...aegislash, label: 'My Aegislash' }], meta, new Map());
    expect(labelled.skipped[0]!.name).toBe('My Aegislash');
  });

  it('reuses cached ratings', () => {
    const fake: Diag[] = [[1, 2, 3], [1, 2, 3], [1, 2, 3]];
    const cache = new Map<string, readonly Diag[]>([[entryKey(medicham), fake]]);
    const { candidates } = simulateRoster(gd, [medicham, azumarill], meta, cache);
    expect(candidates[0]!.ratings).toEqual(fake);
    expect(cache.has(entryKey(azumarill))).toBe(true);
  });

  it('reports progress per entry', () => {
    const calls: [number, number][] = [];
    simulateRoster(gd, [medicham, azumarill], meta, new Map(), (done, total) => calls.push([done, total]));
    expect(calls).toEqual([[1, 2], [2, 2]]);
  });
});

describe('entryKey', () => {
  it('ignores the label', () => {
    expect(entryKey({ ...medicham, label: 'Mine' })).toBe(entryKey(medicham));
    expect(entryKey({ ...medicham, ivs: { atk: 0, def: 15, hp: 15 } })).not.toBe(entryKey({ ...medicham, ivs: { atk: 1, def: 15, hp: 15 } }));
  });
});
