import { readFileSync } from 'node:fs';
import type { GameData } from '../../src/data/types';
import { buildCombatant } from '../../src/engine/combatant';
import { GameDataError, UnsupportedPokemonError } from '../../src/errors';
import type { OracleMon } from './harness';

/** Top `count` ranked Great League Pokémon (with ranking movesets) that this engine supports. */
export function metaSpecies(gd: GameData, count: number): OracleMon[] {
  const rankings: { speciesId: string; moveset: string[] }[] = JSON.parse(readFileSync('data/rankings-1500.json', 'utf8'));
  const out: OracleMon[] = [];
  for (const r of rankings) {
    if (out.length >= count) break;
    try {
      const [fastMoveId, ...chargedMoveIds] = r.moveset;
      buildCombatant(gd, { speciesId: r.speciesId, fastMoveId: fastMoveId!, chargedMoveIds });
      out.push({ speciesId: r.speciesId, moveset: r.moveset });
    } catch (err) {
      // Unsupported (form change, mega, etc.) - excluded from the oracle set by design (spec §10).
      if (!(err instanceof UnsupportedPokemonError || err instanceof GameDataError)) throw err;
    }
  }
  return out;
}
