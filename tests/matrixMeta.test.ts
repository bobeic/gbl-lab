import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { metaSpecies } from '../scripts/oracle/meta';
import { loadDefaultGameData } from '../src/data/node';
import type { GameData } from '../src/data/types';
import { buildCombatant } from '../src/engine/combatant';
import { GameDataError } from '../src/errors';
import { buildMeta, metaCombatant, type RankingRow } from '../src/matrix/meta';

const gd = loadDefaultGameData();
const rankings: RankingRow[] = JSON.parse(readFileSync('data/rankings-1500.json', 'utf8'));
const row = (id: string): RankingRow => rankings.find((r) => r.speciesId === id)!;

describe('buildMeta', () => {
  it('keeps the first `count` supported Pokémon in ranking order with their default IVs', () => {
    const meta = buildMeta(gd, rankings, 5);
    expect(meta.entries).toHaveLength(5);
    expect(meta.entries[0]!.speciesId).toBe('melmetal');
    const m = meta.entries[0]!;
    const built = buildCombatant(gd, { speciesId: 'melmetal', fastMoveId: m.moveset[0], chargedMoveIds: m.moveset.slice(1) });
    expect(m.moveset).toEqual(row('melmetal').moveset);
    expect(m.ivs).toEqual({ atk: built.ivs.atk, def: built.ivs.def, hp: built.ivs.hp });
    expect(m.level).toBe(built.level);
    expect(m.cp).toBe(built.cp);
  });

  it('excludes unsupported Pokémon and records why', () => {
    const meta = buildMeta(gd, [row('cramorant'), row('melmetal'), row('azumarill')], 2);
    expect(meta.entries.map((e) => e.speciesId)).toEqual(['melmetal', 'azumarill']);
    expect(meta.excluded).toHaveLength(1);
    expect(meta.excluded[0]!.speciesId).toBe('cramorant');
    expect(meta.excluded[0]!.reason).toMatch(/^UnsupportedPokemonError: /);
  });

  it('only lists exclusions met before the meta was full', () => {
    // cramorant is 4th in the rankings; a 3-entry meta never reaches it.
    expect(rankings[3]!.speciesId).toBe('cramorant');
    expect(buildMeta(gd, rankings, 3).excluded).toEqual([]);
    expect(buildMeta(gd, rankings, 5).excluded.map((e) => e.speciesId)).toContain('cramorant');
  });

  it('rethrows errors other than unsupported/bad data', () => {
    const broken = { ...gd, species: { get: () => { throw new TypeError('boom'); }, has: () => true, values: () => gd.species.values() } } as unknown as GameData;
    expect(() => buildMeta(broken, [row('melmetal')], 1)).toThrow(TypeError);
  });

  it('rejects a malformed ranking moveset instead of excluding it', () => {
    expect(() => buildMeta(gd, [{ speciesId: 'melmetal', moveset: ['THUNDER_SHOCK'] }], 1)).toThrow(GameDataError);
    expect(() => buildMeta(gd, [{ speciesId: 'melmetal', moveset: ['THUNDER_SHOCK'] }], 1)).toThrow(/melmetal: malformed ranking moveset/);
  });

  it('rejects a non-positive count and a rankings list that runs out', () => {
    expect(() => buildMeta(gd, rankings, 0)).toThrow(RangeError);
    expect(() => buildMeta(gd, [row('melmetal')], 2)).toThrow(/Only 1 supported Pokémon in the rankings; asked for 2/);
  });
});

describe('metaCombatant', () => {
  it('rebuilds the same combatant from the stored entry', () => {
    const m = buildMeta(gd, rankings, 1).entries[0]!;
    const c = metaCombatant(gd, m);
    expect(c.species.id).toBe('melmetal');
    expect([c.ivs.atk, c.ivs.def, c.ivs.hp, c.level, c.cp]).toEqual([m.ivs.atk, m.ivs.def, m.ivs.hp, m.level, m.cp]);
  });
});

describe('oracle metaSpecies (now built on buildMeta)', () => {
  it('still selects exactly the top-100 set the committed oracle fixture was built from', () => {
    const fixture = JSON.parse(readFileSync('tests/fixtures/oracle-gl.json', 'utf8')) as { cases: { a: { speciesId: string; moveset: string[] } }[] };
    const fromFixture = [...new Map(fixture.cases.map((c) => [c.a.speciesId, c.a.moveset])).entries()];
    const ours = metaSpecies(gd, 100).map((m) => [m.speciesId, m.moveset]);
    expect(ours).toEqual(fromFixture);
  });
});
