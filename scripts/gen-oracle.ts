import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { loadDefaultGameData } from '../src/data/node';
import type { ScriptedCharged } from '../src/policy/testPolicies';
import type { OracleMon, PvpokeHarness, PvpokeRequest, PvpokeResult } from './oracle/harness';
import { metaSpecies } from './oracle/meta';
import type { RankingRow } from '../src/matrix/meta';
import { loadPvpoke } from './oracle/load';


const upstream = readFileSync('data/UPSTREAM', 'utf8').trim();
const pvpoke = loadPvpoke();
const gd = loadDefaultGameData();

/** Deterministic pseudo-random generator so fixtures are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Chance-buff moves are excluded from scripted cases: PvPoke sandbox mode never applies them. */
function hasChanceBuff(mon: OracleMon): boolean {
  return mon.moveset.slice(1).some((id) => {
    const m = gd.moves.get(id);
    return !!m && m.kind === 'charged' && !!m.buffs && m.buffs.chance < 1;
  });
}

/** One recorded oracle matchup: the request plus PvPoke's final ratings and HP. */
type OracleCase = PvpokeRequest & Pick<PvpokeResult, 'ratings' | 'hp'>;

/** Run one request through a PvPoke harness and keep the request with its outcome. */
function record(harness: PvpokeHarness, req: PvpokeRequest): OracleCase {
  const res = harness.simulate(req);
  return { ...req, ratings: res.ratings, hp: res.hp };
}

/** Fast-only round robin over the meta plus seeded random scripted cases. */
function engineCases(): OracleCase[] {
  const meta = metaSpecies(gd, 40);
  const rand = mulberry32(20261015);
  const cases: OracleCase[] = [];
  for (let i = 0; i < meta.length; i++) {
    for (let j = i; j < meta.length; j++) {
      cases.push(record(pvpoke, { a: meta[i]!, b: meta[j]!, shields: [0, 0], mode: 'fastOnly' }));
    }
  }
  const scriptable = meta.filter((m) => !hasChanceBuff(m));
  for (let n = 0; n < 400; n++) {
    const a = scriptable[Math.floor(rand() * scriptable.length)]!;
    const b = scriptable[Math.floor(rand() * scriptable.length)]!;
    const script: ScriptedCharged[] = [];
    for (let k = 0; k < 6; k++) {
      const side = (rand() < 0.5 ? 0 : 1) as 0 | 1;
      const mon = side === 0 ? a : b;
      script.push({ side, turn: 5 + Math.floor(rand() * 60), index: Math.floor(rand() * (mon.moveset.length - 1)), shielded: rand() < 0.5 });
    }
    cases.push(record(pvpoke, { a, b, shields: [Math.floor(rand() * 3), Math.floor(rand() * 3)] as [number, number], mode: 'scripted', script }));
  }
  return cases;
}

mkdirSync('tests/fixtures', { recursive: true });
const engine = engineCases();
writeFileSync('tests/fixtures/engine-oracle.json', JSON.stringify({ upstream, cases: engine }));
console.log(`engine-oracle.json: ${engine.length} cases`);

/** Default-policy round robin over the top-100 meta at 0, 1 and 2 shields each. */
function defaultCases(): OracleCase[] {
  const meta = metaSpecies(gd, 100);
  const cases: OracleCase[] = [];
  for (const s of [0, 1, 2] as const) {
    for (let i = 0; i < meta.length; i++) {
      for (let j = i; j < meta.length; j++) {
        cases.push(record(pvpoke, { a: meta[i]!, b: meta[j]!, shields: [s, s], mode: 'default' }));
      }
    }
  }
  return cases;
}

const def = defaultCases();
writeFileSync('tests/fixtures/oracle-gl.json', JSON.stringify({ upstream, cases: def }));
console.log(`oracle-gl.json: ${def.length} cases`);

/** One form changer against every top-100 opponent at all nine shield pairings (form-changes spec §6.1). */
function formChangeCases(harness: PvpokeHarness, meta: OracleMon[], speciesId: string, opponents: OracleMon[]): OracleCase[] {
  const mon = meta.find((m) => m.speciesId === speciesId);
  if (!mon) throw new Error(`${speciesId} is not in the top-100 meta`);
  const cases: OracleCase[] = [];
  for (const opp of opponents) {
    for (const s0 of [0, 1, 2]) {
      for (const s1 of [0, 1, 2]) cases.push(record(harness, { a: mon, b: opp, shields: [s0, s1], mode: 'default' }));
    }
  }
  return cases;
}

const top100 = metaSpecies(gd, 100);
const unmodified = loadPvpoke('unmodified');
const formChange = {
  upstream,
  corrected: [
    ...formChangeCases(pvpoke, top100, 'mimikyu', top100),
    ...formChangeCases(pvpoke, top100, 'morpeko_full_belly', top100),
    ...formChangeCases(pvpoke, top100, 'cramorant', top100), // includes the Cramorant mirror
  ],
  // Unmodified PvPoke must agree for Mimikyu and Cramorant (excluding Morpeko opponents): the corrections touch only Morpeko.
  unmodified: [
    ...formChangeCases(unmodified, top100, 'mimikyu', top100.filter((m) => m.speciesId !== 'morpeko_full_belly')),
    ...formChangeCases(unmodified, top100, 'cramorant', top100.filter((m) => m.speciesId !== 'morpeko_full_belly')),
  ],
};
writeFileSync('tests/fixtures/form-change-oracle.json', JSON.stringify(formChange));
console.log(`form-change-oracle.json: ${formChange.corrected.length} corrected + ${formChange.unmodified.length} unmodified cases`);

/** Every mega Mega Halloween Cup ranks (super megas with their mega move) against that cup's top 50 at all nine shield pairings. */
function megaCases(): OracleCase[] {
  const rankings: RankingRow[] = JSON.parse(readFileSync('data/rankings-halloweenmega-1500.json', 'utf8'));
  const megas: OracleMon[] = rankings
    .filter((r) => gd.species.get(r.speciesId)?.tags.includes('mega'))
    .map((r) => ({ speciesId: r.speciesId, moveset: [...r.moveset] }));
  const opponents = metaSpecies(gd, 50, 'data/rankings-halloweenmega-1500.json');
  const cases: OracleCase[] = [];
  for (const mon of megas) {
    for (const opp of opponents) {
      for (const s0 of [0, 1, 2]) {
        for (const s1 of [0, 1, 2]) cases.push(record(pvpoke, { a: mon, b: opp, shields: [s0, s1], mode: 'default' }));
      }
    }
  }
  return cases;
}

const mega = megaCases();
writeFileSync('tests/fixtures/mega-oracle.json', JSON.stringify({ upstream, cases: mega }));
console.log(`mega-oracle.json: ${mega.length} cases`);
