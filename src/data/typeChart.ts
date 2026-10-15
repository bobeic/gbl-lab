import type { PokemonType } from './types';

export const SUPER_EFFECTIVE = 1.60000002384185791015625;
export const RESISTED = 0.625;
export const DOUBLE_RESISTED = 0.390625;

interface Traits {
  readonly weaknesses: readonly PokemonType[];
  readonly resistances: readonly PokemonType[];
  readonly immunities: readonly PokemonType[];
}

const TRAITS: Readonly<Record<PokemonType, Traits>> = {
  normal: { resistances: [], weaknesses: ['fighting'], immunities: ['ghost'] },
  fighting: { resistances: ['rock', 'bug', 'dark'], weaknesses: ['flying', 'psychic', 'fairy'], immunities: [] },
  flying: { resistances: ['fighting', 'bug', 'grass'], weaknesses: ['rock', 'electric', 'ice'], immunities: ['ground'] },
  poison: { resistances: ['fighting', 'poison', 'bug', 'fairy', 'grass'], weaknesses: ['ground', 'psychic'], immunities: [] },
  ground: { resistances: ['poison', 'rock'], weaknesses: ['water', 'grass', 'ice'], immunities: ['electric'] },
  rock: { resistances: ['normal', 'flying', 'poison', 'fire'], weaknesses: ['fighting', 'ground', 'steel', 'water', 'grass'], immunities: [] },
  bug: { resistances: ['fighting', 'ground', 'grass'], weaknesses: ['flying', 'rock', 'fire'], immunities: [] },
  ghost: { resistances: ['poison', 'bug'], weaknesses: ['ghost', 'dark'], immunities: ['normal', 'fighting'] },
  steel: {
    resistances: ['normal', 'flying', 'rock', 'bug', 'steel', 'grass', 'psychic', 'ice', 'dragon', 'fairy'],
    weaknesses: ['fighting', 'ground', 'fire'],
    immunities: ['poison'],
  },
  fire: { resistances: ['bug', 'steel', 'fire', 'grass', 'ice', 'fairy'], weaknesses: ['ground', 'rock', 'water'], immunities: [] },
  water: { resistances: ['steel', 'fire', 'water', 'ice'], weaknesses: ['grass', 'electric'], immunities: [] },
  grass: { resistances: ['ground', 'water', 'grass', 'electric'], weaknesses: ['flying', 'poison', 'bug', 'fire', 'ice'], immunities: [] },
  electric: { resistances: ['flying', 'steel', 'electric'], weaknesses: ['ground'], immunities: [] },
  psychic: { resistances: ['fighting', 'psychic'], weaknesses: ['bug', 'ghost', 'dark'], immunities: [] },
  ice: { resistances: ['ice'], weaknesses: ['fighting', 'fire', 'steel', 'rock'], immunities: [] },
  dragon: { resistances: ['fire', 'water', 'grass', 'electric'], weaknesses: ['dragon', 'ice', 'fairy'], immunities: [] },
  dark: { resistances: ['ghost', 'dark'], weaknesses: ['fighting', 'fairy', 'bug'], immunities: ['psychic'] },
  fairy: { resistances: ['fighting', 'bug', 'dark'], weaknesses: ['poison', 'steel'], immunities: ['dragon'] },
};

/** Return the type-effectiveness multiplier of a move type against a defender's types. */
export function effectiveness(moveType: PokemonType, defenderTypes: readonly PokemonType[]): number {
  let result = 1;
  for (const type of defenderTypes) {
    const traits = TRAITS[type];
    if (traits.weaknesses.includes(moveType)) result *= SUPER_EFFECTIVE;
    else if (traits.resistances.includes(moveType)) result *= RESISTED;
    else if (traits.immunities.includes(moveType)) result *= DOUBLE_RESISTED;
  }
  return result;
}
