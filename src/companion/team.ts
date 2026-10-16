import { GameDataError } from '../errors';
import type { RosterEntry } from '../matrix/teamMatrix';
import type { AppData } from './appData';

/** A new roster entry for a ranked species, using its ranking moveset and default IVs. */
export function defaultRosterEntry(app: AppData, speciesId: string): RosterEntry {
  const ranked = app.byId.get(speciesId);
  if (!ranked) throw new GameDataError(`${speciesId} is not in the Great League rankings`);
  const [fastMoveId, ...chargedMoveIds] = ranked.moveset;
  return { speciesId, fastMoveId, chargedMoveIds };
}
