import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { loadDefaultGameData } from '../src/data/node';
import type { ScriptedCharged } from '../src/policy/testPolicies';
import type { OracleMon, PvpokeHarness, PvpokeRequest, PvpokeResult } from './oracle/harness';
import { metaSpecies } from './oracle/meta';

const require = createRequire(import.meta.url);
const { createPvpoke } = require('./oracle/pvpokeHarness.cjs') as { createPvpoke: (dir: string) => PvpokeHarness };

const upstream = readFileSync('data/UPSTREAM', 'utf8').trim();
const pvpoke = createPvpoke('.cache/pvpoke/src');
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

/** Run one request through PvPoke and keep the request with its outcome. */
function record(req: PvpokeRequest): OracleCase {
  const res = pvpoke.simulate(req);
  return { ...req, ratings: res.ratings, hp: res.hp };
}

/** Fast-only round robin over the meta plus seeded random scripted cases. */
function engineCases(): OracleCase[] {
  const meta = metaSpecies(gd, 40);
  const rand = mulberry32(20261015);
  const cases: OracleCase[] = [];
  for (let i = 0; i < meta.length; i++) {
    for (let j = i; j < meta.length; j++) {
      cases.push(record({ a: meta[i]!, b: meta[j]!, shields: [0, 0], mode: 'fastOnly' }));
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
    cases.push(record({ a, b, shields: [Math.floor(rand() * 3), Math.floor(rand() * 3)] as [number, number], mode: 'scripted', script }));
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
        cases.push(record({ a: meta[i]!, b: meta[j]!, shields: [s, s], mode: 'default' }));
      }
    }
  }
  return cases;
}

const def = defaultCases();
writeFileSync('tests/fixtures/oracle-gl.json', JSON.stringify({ upstream, cases: def }));
console.log(`oracle-gl.json: ${def.length} cases`);
