import type { GameData } from '../data/types';
import { RosterError } from '../errors';
import { simulateDiagonal } from '../matrix/cell';
import { metaCombatant, type MetaEntry } from '../matrix/meta';
import { buildRosterCombatant, type RosterEntry } from '../matrix/teamMatrix';
import type { Candidate, Diag } from './teamBuilder';

/** Cache key: species, moves, IVs and level. The label is not part of it. */
export function entryKey(entry: RosterEntry): string {
  return JSON.stringify([entry.speciesId, entry.fastMoveId, entry.chargedMoveIds, entry.ivs ?? null, entry.level ?? null]);
}

export interface SimResult {
  readonly candidates: Candidate[];
  readonly skipped: { readonly name: string; readonly reason: string }[];
}

/** Rate each roster entry against the meta at 0-0, 1-1 and 2-2, reusing `cache`; entries the engine can't build are skipped. */
export function simulateRoster(
  gd: GameData, roster: readonly RosterEntry[], meta: readonly MetaEntry[],
  cache: Map<string, readonly Diag[]>, onProgress?: (done: number, total: number) => void,
): SimResult {
  const opponents = meta.map((m) => metaCombatant(gd, m));
  const candidates: Candidate[] = [];
  const skipped: SimResult['skipped'] = [];
  roster.forEach((entry, i) => {
    try {
      const key = entryKey(entry);
      let ratings = cache.get(key);
      if (!ratings) {
        const me = buildRosterCombatant(gd, entry, i);
        ratings = opponents.map((o) => simulateDiagonal(gd, me, o));
        cache.set(key, ratings);
      }
      const species = gd.species.get(entry.speciesId)!;
      candidates.push({ index: i, dex: species.dex, mega: species.tags.includes('mega'), ratings });
    } catch (err) {
      if (!(err instanceof RosterError)) throw err;
      skipped.push({ name: entry.label ?? entry.speciesId, reason: err.message });
    }
    onProgress?.(i + 1, roster.length);
  });
  return { candidates, skipped };
}
