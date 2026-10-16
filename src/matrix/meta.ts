import type { GameData } from '../data/types';
import { buildCombatant, type Combatant } from '../engine/combatant';
import { GameDataError, UnsupportedPokemonError } from '../errors';
import type { Ivs } from '../stats/stats';

/** One row of PvPoke's rankings JSON, as far as the matrix needs it. */
export interface RankingRow {
  readonly speciesId: string;
  readonly moveset: readonly string[];
}

/** A meta Pokémon exactly as simulated: species, moves, and the IVs/level PvPoke uses by default. */
export interface MetaEntry {
  readonly speciesId: string;
  /** [fast, charged1, charged2?] */
  readonly moveset: readonly [string, ...string[]];
  readonly ivs: Ivs;
  readonly level: number;
  readonly cp: number;
}

export interface ExcludedEntry {
  readonly speciesId: string;
  /** "<ErrorName>: <message>" */
  readonly reason: string;
}

export interface Meta {
  readonly entries: readonly MetaEntry[];
  readonly excluded: readonly ExcludedEntry[];
}

function rowMoveset(row: RankingRow): readonly [string, ...string[]] {
  const ms = row.moveset as unknown;
  if (!Array.isArray(ms) || ms.length < 2 || ms.some((m) => typeof m !== 'string' || m === '')) {
    throw new GameDataError(`${row.speciesId}: malformed ranking moveset ${JSON.stringify(ms)}`);
  }
  return ms as [string, ...string[]];
}

/** Pick the first `count` Pokémon in ranking order that the engine supports, recording the ones it skipped. */
export function buildMeta(gd: GameData, rankings: readonly RankingRow[], count: number): Meta {
  if (!Number.isInteger(count) || count < 1) throw new RangeError(`Meta size must be a positive integer, got ${count}`);
  const entries: MetaEntry[] = [];
  const excluded: ExcludedEntry[] = [];
  for (const row of rankings) {
    if (entries.length >= count) break;
    // A malformed row is a data bug, not an unsupported Pokémon, so it is checked outside the try.
    const moveset = rowMoveset(row);
    try {
      const [fastMoveId, ...chargedMoveIds] = moveset;
      const c = buildCombatant(gd, { speciesId: row.speciesId, fastMoveId, chargedMoveIds });
      entries.push({ speciesId: row.speciesId, moveset, ivs: { atk: c.ivs.atk, def: c.ivs.def, hp: c.ivs.hp }, level: c.level, cp: c.cp });
    } catch (err) {
      if (!(err instanceof UnsupportedPokemonError || err instanceof GameDataError)) throw err;
      excluded.push({ speciesId: row.speciesId, reason: `${err.name}: ${err.message}` });
    }
  }
  if (entries.length < count) throw new GameDataError(`Only ${entries.length} supported Pokémon in the rankings; asked for ${count}`);
  return { entries, excluded };
}

/** Build the battle-ready combatant for a stored meta entry. */
export function metaCombatant(gd: GameData, entry: MetaEntry): Combatant {
  const [fastMoveId, ...chargedMoveIds] = entry.moveset;
  return buildCombatant(gd, { speciesId: entry.speciesId, fastMoveId, chargedMoveIds, ivs: entry.ivs, level: entry.level });
}
