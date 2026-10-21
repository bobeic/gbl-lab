import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { handleRequest, type BuilderReply } from '../src/companion';
import { loadDefaultGameData } from '../src/data/node';
import { buildMeta, type MetaEntry, type RankingRow } from '../src/matrix/meta';

const gd = loadDefaultGameData();
const rankings = JSON.parse(readFileSync('data/rankings-1500.json', 'utf8')) as RankingRow[];
const meta = buildMeta(gd, rankings, 150).entries.slice(0, 3);
const medicham = { speciesId: 'medicham', fastMoveId: 'COUNTER', chargedMoveIds: ['ICE_PUNCH', 'PSYCHIC'] };

describe('handleRequest', () => {
  it('posts progress then done with meta ids', () => {
    const posts: BuilderReply[] = [];
    handleRequest(gd, meta, new Map(), { id: 7, format: 'great', roster: [medicham] }, (r) => posts.push(r));
    expect(posts.map((p) => p.type)).toEqual(['progress', 'done']);
    expect(posts[0]).toEqual({ id: 7, type: 'progress', done: 1, total: 1 });
    const done = posts[1]!;
    if (done.type !== 'done') throw new Error('expected done');
    expect(done.id).toBe(7);
    expect(done.metaIds).toEqual(meta.map((m) => m.speciesId));
    expect(done.result.candidates.length).toBe(1);
  });

  it('posts an error instead of throwing', () => {
    const bad: MetaEntry[] = [{ ...meta[0]!, speciesId: 'not_a_pokemon' }];
    const posts: BuilderReply[] = [];
    expect(() => handleRequest(gd, bad, new Map(), { id: 3, format: 'great', roster: [medicham] }, (r) => posts.push(r))).not.toThrow();
    expect(posts).toEqual([{ id: 3, type: 'error', message: expect.any(String) }]);
  });
});
