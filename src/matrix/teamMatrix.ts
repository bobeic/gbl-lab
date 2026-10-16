import type { GameData } from '../data/types';
import { buildCombatant, type Combatant } from '../engine/combatant';
import { GameDataError, RosterError, StatsError, UnsupportedPokemonError } from '../errors';
import type { Ivs } from '../stats/stats';
import { simulateCell, type MatrixRow } from './cell';
import { metaCombatant, type MetaEntry } from './meta';

/** One of the user's own Pokémon. */
export interface RosterEntry {
  readonly speciesId: string;
  readonly fastMoveId: string;
  readonly chargedMoveIds: readonly string[];
  /** Default: the species' default Great League IVs. */
  readonly ivs?: Ivs;
  /** Default: the highest level under 1500 CP for these IVs. */
  readonly level?: number;
  /** Display name, e.g. "Melmetal (my 0/15/14)"; the row id. */
  readonly label?: string;
}

const ROSTER_FIELDS: ReadonlySet<string> = new Set(['speciesId', 'fastMoveId', 'chargedMoveIds', 'ivs', 'level', 'label']);
const isRecord =(v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');

/** Check that parsed JSON has the shape of a roster; building the Pokémon is teamMatrix's job. */
export function parseRoster(json: unknown): RosterEntry[] {
  if (!Array.isArray(json)) throw new RosterError('Roster must be a JSON array of entries');
  return json.map((v, i): RosterEntry => {
    const bad = (field: string, expected: string): never => {
      throw new RosterError(`Roster entry ${i}: ${field} must be ${expected}`);
    };
    if (!isRecord(v)) return bad('the entry', 'an object');
    // A misspelt optional field (e.g. "IVs") would otherwise silently fall back to default IVs or level.
    const unknown = Object.keys(v).find((k) => !ROSTER_FIELDS.has(k));
    if (unknown !== undefined) throw new RosterError(`Roster entry ${i}: unknown field "${unknown}" (allowed: ${[...ROSTER_FIELDS].join(', ')})`);
    if (typeof v.speciesId !== 'string' || v.speciesId === '') bad('speciesId', 'a non-empty string');
    if (typeof v.fastMoveId !== 'string' || v.fastMoveId === '') bad('fastMoveId', 'a non-empty string');
    if (!isStringArray(v.chargedMoveIds)) bad('chargedMoveIds', 'an array of move ids');
    const ivs = v.ivs;
    if (ivs !== undefined && !(isRecord(ivs) && ['atk', 'def', 'hp'].every((k) => typeof ivs[k] === 'number'))) bad('ivs', 'an object with numeric atk, def and hp');
    if (v.level !== undefined && typeof v.level !== 'number') bad('level', 'a number');
    if (v.label !== undefined && typeof v.label !== 'string') bad('label', 'a string');
    return v as unknown as RosterEntry;
  });
}

/** Build one roster Pokémon, wrapping any failure in a RosterError that names the entry. */
export function buildRosterCombatant(gd: GameData, entry: RosterEntry, index: number): Combatant {
  try {
    return buildCombatant(gd, {
      speciesId: entry.speciesId, fastMoveId: entry.fastMoveId, chargedMoveIds: entry.chargedMoveIds, ivs: entry.ivs, level: entry.level,
    });
  } catch (err) {
    if (!(err instanceof GameDataError || err instanceof StatsError || err instanceof UnsupportedPokemonError)) throw err;
    throw new RosterError(`Roster entry ${index} (${entry.label ?? entry.speciesId}): ${err.message}`, { cause: err });
  }
}

/** Simulate each roster Pokémon against every meta entry in all 9 shield scenarios. */
export function teamMatrix(gd: GameData, roster: readonly RosterEntry[], meta: readonly MetaEntry[]): MatrixRow[] {
  // Build everything first so a bad entry fails before any simulation runs.
  const mine = roster.map((entry, i) => buildRosterCombatant(gd, entry, i));
  const opponents = meta.map((m) => metaCombatant(gd, m));
  return mine.map((c, i) => ({
    id: roster[i]!.label ?? roster[i]!.speciesId,
    cells: opponents.map((o) => simulateCell(gd, c, o)),
  }));
}
