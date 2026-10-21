import { GameDataError } from '../errors';
import type { RosterEntry } from '../matrix/teamMatrix';
import type { AppData } from './appData';

/** A new roster entry for a ranked species, using its ranking moveset and default IVs. */
export function defaultRosterEntry(app: AppData, speciesId: string): RosterEntry {
  const ranked = app.byId.get(speciesId);
  if (!ranked) throw new GameDataError(`${speciesId} is not in the ${app.format.title} rankings`);
  const [fastMoveId, ...chargedMoveIds] = ranked.moveset;
  return { speciesId, fastMoveId, chargedMoveIds };
}

/** The entry with this format's ranking moveset; an entry the format doesn't rank keeps its own moves. */
export function formatEntry(app: AppData, entry: RosterEntry): RosterEntry {
  const ranked = app.byId.get(entry.speciesId);
  if (!ranked) return entry;
  const [fastMoveId, ...chargedMoveIds] = ranked.moveset;
  return { ...entry, fastMoveId, chargedMoveIds };
}
