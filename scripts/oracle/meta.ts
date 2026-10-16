import { readFileSync } from 'node:fs';
import type { GameData } from '../../src/data/types';
import { buildMeta, type RankingRow } from '../../src/matrix/meta';
import type { OracleMon } from './harness';

/** Top `count` ranked Great League Pokémon (with ranking movesets) that this engine supports. */
export function metaSpecies(gd: GameData, count: number): OracleMon[] {
  const rankings: RankingRow[] = JSON.parse(readFileSync('data/rankings-1500.json', 'utf8'));
  const meta = buildMeta(gd, rankings, count);
  // Unsupported (Aegislash, Cramorant, megas, etc.) are excluded from the oracle set by design (engine spec §10).
  for (const e of meta.excluded) console.error(`excluded ${e.speciesId}: ${e.reason}`);
  return meta.entries.map((e) => ({ speciesId: e.speciesId, moveset: [...e.moveset] }));
}
