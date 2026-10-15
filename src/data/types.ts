export const POKEMON_TYPES = [
  'normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel',
  'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark', 'fairy',
] as const;

export type PokemonType = (typeof POKEMON_TYPES)[number];

export type StatPair = readonly [atk: number, def: number];

export type BuffTarget = 'self' | 'opponent' | 'both';

export interface MoveBuffs {
  /** Stages for 'self' or 'opponent' targets. */
  readonly stages: StatPair;
  readonly target: BuffTarget;
  /** Probability 0..1. */
  readonly chance: number;
  /** Only for target 'both'. */
  readonly selfStages?: StatPair;
  readonly opponentStages?: StatPair;
}

export interface FastMove {
  readonly kind: 'fast';
  readonly id: string;
  readonly name: string;
  readonly type: PokemonType;
  readonly power: number;
  readonly energyGain: number;
  readonly turns: number;
  readonly cooldownMs: number;
  readonly buffs?: MoveBuffs;
  readonly damageMethod: string;
  readonly tags: readonly string[];
}

export interface ChargedMove {
  readonly kind: 'charged';
  readonly id: string;
  readonly name: string;
  readonly type: PokemonType;
  readonly power: number;
  readonly energy: number;
  readonly buffs?: MoveBuffs;
  readonly damageMethod: string;
  readonly tags: readonly string[];
  /** Flags derived exactly as PvPoke GameMaster.js:880-896. */
  readonly selfDebuffing: boolean;
  readonly selfAttackDebuffing: boolean;
  readonly selfDefenseDebuffing: boolean;
  readonly selfBuffing: boolean;
}

export type Move = FastMove | ChargedMove;

export interface DefaultIvs {
  readonly level: number;
  readonly atk: number;
  readonly def: number;
  readonly hp: number;
}

export interface Species {
  readonly id: string;
  readonly dex: number;
  readonly name: string;
  /** One or two types; PvPoke's "none" placeholder is dropped. */
  readonly types: readonly PokemonType[];
  readonly base: { readonly atk: number; readonly def: number; readonly hp: number };
  readonly fastMoveIds: readonly string[];
  readonly chargedMoveIds: readonly string[];
  readonly eliteMoveIds: readonly string[];
  readonly tags: readonly string[];
  readonly nativeStatBuffs: StatPair;
  readonly hasFormChange: boolean;
  /** Lowest level PvPoke's IV ranking considers (gamemaster levelFloor, default 1). */
  readonly levelFloor: number;
  /** PvPoke's defaultIVs.cp1500, used by its rankings. */
  readonly defaultIvsGreat: DefaultIvs;
}

export interface GameData {
  readonly species: ReadonlyMap<string, Species>;
  readonly moves: ReadonlyMap<string, Move>;
  readonly maxBuffStages: number;
  readonly buffDivisor: number;
}
