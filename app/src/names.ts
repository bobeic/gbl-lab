import type { AppData } from '../../src/companion';
import type { RosterEntry } from '../../src/matrix/teamMatrix';

/** The species' display name, e.g. "Medicham (Shadow)". */
export function speciesName(app: AppData, speciesId: string): string {
  return app.byId.get(speciesId)?.name ?? app.gd.species.get(speciesId)?.name ?? speciesId;
}

/** The user's label for a roster entry, or its species name. */
export function entryName(app: AppData, entry: RosterEntry): string {
  return entry.label ?? speciesName(app, entry.speciesId);
}

/** A move's display name. */
export function moveName(app: AppData, moveId: string): string {
  return app.gd.moves.get(moveId)?.name ?? moveId;
}

/** An error message, naming the underlying error type when one was wrapped (e.g. UnsupportedPokemonError). */
export function errorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  return err.cause instanceof Error ? `${err.message} (${err.cause.name})` : err.message;
}
