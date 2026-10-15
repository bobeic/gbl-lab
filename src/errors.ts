/** Raised when game data is malformed or references something missing. */
export class GameDataError extends Error {
  override name = 'GameDataError';
}

/** Raised for invalid stat inputs (IVs out of range, impossible level). */
export class StatsError extends Error {
  override name = 'StatsError';
}

/** Raised for Pokémon or moves whose mechanics this engine does not model yet. */
export class UnsupportedPokemonError extends Error {
  override name = 'UnsupportedPokemonError';
}

/** Raised when a policy returns an action the rules do not allow. */
export class IllegalActionError extends Error {
  override name = 'IllegalActionError';
}

/** Raised when a battle exceeds the turn limit; carries the events so far for debugging. */
export class TurnLimitError extends Error {
  override name = 'TurnLimitError';
  constructor(message: string, readonly events: readonly unknown[]) {
    super(message);
  }
}
