import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { IvCombinationsRequest, PvpokeHarness, PvpokeIvCombination } from './oracle/harness';

const require = createRequire(import.meta.url);
const { createPvpoke } = require('./oracle/pvpokeHarness.cjs') as { createPvpoke: (dir: string) => PvpokeHarness };

const upstream = readFileSync('data/UPSTREAM', 'utf8').trim();
const pvpoke = createPvpoke('.cache/pvpoke/src');

const GL = (speciesId: string, extra: Partial<IvCombinationsRequest> = {}): IvCombinationsRequest => ({ speciesId, cap: 1500, ...extra });

// Covers every default-floor rule (wild, legendary 1, shadow legendary 6, wildlegendary, untradeable 10, Return 2),
// species levelFloor, Shedinja, an explicit floor, other caps, and a species with no combination under the cap.
const REQUESTS: readonly IvCombinationsRequest[] = [
  GL('medicham'), GL('azumarill'), GL('lickitung'), GL('stunfisk_galarian'), GL('shedinja'),
  GL('registeel'), GL('cresselia'), GL('mewtwo'), GL('dialga'), GL('giratina_altered'),
  GL('zapdos_shadow'), GL('raikou'), GL('raikou_shadow'), GL('jirachi'),
  GL('heatran_shadow'), GL('giratina_origin'), GL('tapu_fini'), GL('larvesta'),
  GL('ivysaur'), GL('ivysaur', { chargedMoveIds: ['POWER_WHIP', 'SLUDGE_BOMB'] }),
  GL('darkrai'),
  GL('medicham', { ivFloor: 4 }), GL('registeel', { ivFloor: 10 }),
  { speciesId: 'larvesta', cap: 500 }, { speciesId: 'registeel', cap: 2500 },
];

/** Compact encoding of one combination: atk/def/hp as hex digits, then the level. */
function encode(c: PvpokeIvCombination): string {
  return `${c[0].toString(16)}${c[1].toString(16)}${c[2].toString(16)}${c[3]}`;
}

const cases = REQUESTS.map((req) => {
  const r = pvpoke.ivCombinations(req);
  return { request: req, chargedMoveIds: r.chargedMoveIds, combinations: r.combinations.map(encode).join(' ') };
});

mkdirSync('tests/fixtures', { recursive: true });
writeFileSync('tests/fixtures/iv-rank-oracle.json', JSON.stringify({ upstream, cases }));
console.log(`wrote ${cases.length} IV ranking cases`);
