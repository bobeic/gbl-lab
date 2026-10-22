import type { GameData, PokemonType } from '../data/types';
import { buildCombatant, type Combatant } from '../engine/combatant';
import { GameDataError, UnsupportedPokemonError } from '../errors';
import type { AppData } from './appData';
import { countSequence } from './counts';
import { effectText } from './moveAdvice';

export interface MoveInfo {
  readonly id: string;
  readonly name: string;
  readonly type: PokemonType;
}

export interface FastInfo extends MoveInfo {
  readonly energyGain: number;
  readonly turns: number;
}

export interface ChargedInfo extends MoveInfo {
  readonly energy: number;
  /** Fast moves needed for the 1st, 2nd and 3rd throw. */
  readonly counts: readonly number[];
  /** Its stat changes as thrown by the opponent, e.g. "lowers your Attack 1 stage"; null for none. */
  readonly effect: string | null;
}

/** What the battle screen shows about the opponent on the field. */
export interface OpponentCard {
  readonly speciesId: string;
  readonly name: string;
  readonly types: readonly PokemonType[];
  readonly fast: FastInfo;
  readonly charged: readonly ChargedInfo[];
  /** null when the engine can't simulate this species. */
  readonly combatant: Combatant | null;
  /** "<ErrorName>: <message>" when combatant is null. */
  readonly unsupportedReason: string | null;
}

/** Describe a fast move and charged moves, with count sequences driven by that fast move. */
export function movesetInfo(gd: GameData, fastMoveId: string, chargedMoveIds: readonly string[]): { fast: FastInfo; charged: ChargedInfo[] } {
  const f = gd.moves.get(fastMoveId);
  if (f?.kind !== 'fast') throw new GameDataError(`${fastMoveId} is not a fast move`);
  const fast: FastInfo = { id: f.id, name: f.name, type: f.type, energyGain: f.energyGain, turns: f.turns };
  const charged = chargedMoveIds.map((id): ChargedInfo => {
    const c = gd.moves.get(id);
    if (c?.kind !== 'charged') throw new GameDataError(`${id} is not a charged move`);
    return { id: c.id, name: c.name, type: c.type, energy: c.energy, counts: countSequence(f.energyGain, c.energy), effect: effectText(c.buffs, 'their') };
  });
  return { fast, charged };
}

/** Build the card for a ranked opponent: its ranking moveset, counts and (if supported) a combatant at default IVs. */
export function opponentCard(app: AppData, speciesId: string): OpponentCard {
  const ranked = app.byId.get(speciesId);
  if (!ranked) throw new GameDataError(`${speciesId} is not in the ${app.format.title} rankings`);
  const species = app.gd.species.get(speciesId);
  if (!species) throw new GameDataError(`Unknown species ${speciesId}`);
  const [fastMoveId, ...chargedMoveIds] = ranked.moveset;
  const { fast, charged } = movesetInfo(app.gd, fastMoveId, chargedMoveIds);
  let combatant: Combatant | null = null;
  let unsupportedReason: string | null = null;
  try {
    combatant = buildCombatant(app.gd, { speciesId, fastMoveId, chargedMoveIds });
  } catch (err) {
    if (!(err instanceof UnsupportedPokemonError || err instanceof GameDataError)) throw err;
    unsupportedReason = `${err.name}: ${err.message}`;
  }
  return { speciesId, name: ranked.name, types: species.types, fast, charged, combatant, unsupportedReason };
}
