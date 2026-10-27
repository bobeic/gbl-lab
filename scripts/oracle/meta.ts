import { readFileSync } from 'node:fs';
import type { GameData } from '../../src/data/types';
import { buildMeta, type RankingRow } from '../../src/matrix/meta';
import type { OracleMon } from './harness';

/** Top `count` ranked Pokémon (with ranking movesets) that this engine supports; open Great League unless given another rankings file. */
export function metaSpecies(gd: GameData, count: number, rankingsPath = 'data/rankings-1500.json'): OracleMon[] {
  const rankings: RankingRow[] = JSON.parse(readFileSync(rankingsPath, 'utf8'));
  const meta = buildMeta(gd, rankings, count);
  // Unsupported (Aegislash, super megas' mega moves, etc.) are excluded from the oracle set by design (engine spec §10).
  for (const e of meta.excluded) console.error(`excluded ${e.speciesId}: ${e.reason}`);
  return meta.entries.map((e) => ({ speciesId: e.speciesId, moveset: [...e.moveset] }));
}
