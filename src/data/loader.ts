import { GameDataError } from '../errors';
import {
  POKEMON_TYPES, type BuffTarget, type ChargedMove, type FastMove, type GameData, type Move,
  type MoveBuffs, type PokemonType, type Species, type StatPair,
} from './types';

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(obj: Raw, key: string, ctx: string): number {
  const value = obj[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new GameDataError(`${ctx}: field "${key}" must be a finite number`);
  }
  return value;
}

function str(obj: Raw, key: string, ctx: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new GameDataError(`${ctx}: field "${key}" must be a non-empty string`);
  }
  return value;
}

function strArray(obj: Raw, key: string, ctx: string, required: boolean): string[] {
  const value = obj[key];
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new GameDataError(`${ctx}: field "${key}" must be an array of strings`);
  }
  return value as string[];
}

function pair(value: unknown, ctx: string): StatPair {
  if (!Array.isArray(value) || value.length !== 2 || !value.every((v) => typeof v === 'number')) {
    throw new GameDataError(`${ctx}: expected a [atk, def] number pair`);
  }
  return [value[0] as number, value[1] as number];
}

function pokemonType(value: unknown, ctx: string): PokemonType {
  if (typeof value !== 'string' || !(POKEMON_TYPES as readonly string[]).includes(value)) {
    throw new GameDataError(`${ctx}: unknown type "${String(value)}"`);
  }
  return value as PokemonType;
}

function parseBuffs(m: Raw, ctx: string): MoveBuffs | undefined {
  if (m.buffs === undefined) return undefined;
  const target = str(m, 'buffTarget', ctx);
  if (target !== 'self' && target !== 'opponent' && target !== 'both') {
    throw new GameDataError(`${ctx}: unknown buffTarget "${target}"`);
  }
  const chance = Number.parseFloat(String(m.buffApplyChance));
  if (!Number.isFinite(chance) || chance < 0 || chance > 1) {
    throw new GameDataError(`${ctx}: buffApplyChance must be between 0 and 1`);
  }
  const buffs: MoveBuffs = { stages: pair(m.buffs, ctx), target: target as BuffTarget, chance };
  if (target === 'both') {
    return { ...buffs, selfStages: pair(m.buffsSelf, ctx), opponentStages: pair(m.buffsOpponent, ctx) };
  }
  return buffs;
}

function parseMove(m: unknown, index: number): Move {
  if (!isRecord(m)) throw new GameDataError(`moves[${index}]: expected an object`);
  const id = str(m, 'moveId', `moves[${index}]`);
  const common = {
    id,
    name: str(m, 'name', id),
    type: pokemonType(m.type, id),
    power: num(m, 'power', id),
    damageMethod: typeof m.damageMethod === 'string' ? m.damageMethod : 'default',
    tags: strArray(m, 'tags', id, false),
    buffs: parseBuffs(m, id),
  };
  const energyGain = num(m, 'energyGain', id);
  // Same classification as PvPoke GameMaster.js:831,856
  const category = typeof m.category === 'string' ? m.category : energyGain > 0 ? 'fast' : 'charged';
  if (category === 'fast') {
    const fast: FastMove = {
      ...common, kind: 'fast', energyGain, turns: num(m, 'turns', id), cooldownMs: num(m, 'cooldown', id),
    };
    return fast;
  }
  const b = common.buffs;
  // Flag derivation mirrors PvPoke GameMaster.js:880-896
  const selfDebuffing = !!b && b.target === 'self' && b.chance >= 0.5 && id !== 'DRAGON_ASCENT'
    && (b.stages[0] < 0 || b.stages[1] < 0);
  const selfBuffing = !!b && b.chance === 1 && (
    b.target === 'opponent'
    || (b.target === 'self' && (b.stages[0] > 0 || b.stages[1] > 0))
    || (b.target === 'both' && ((b.selfStages?.[0] ?? 0) > 0 || (b.selfStages?.[1] ?? 0) > 0))
  );
  const charged: ChargedMove = {
    ...common,
    kind: 'charged',
    energy: num(m, 'energy', id),
    selfDebuffing,
    selfAttackDebuffing: selfDebuffing && b!.stages[0] < 0,
    selfDefenseDebuffing: selfDebuffing && b!.stages[1] < 0,
    selfBuffing,
  };
  return charged;
}

function parseSpecies(p: unknown, index: number, moves: ReadonlyMap<string, Move>): Species {
  if (!isRecord(p)) throw new GameDataError(`pokemon[${index}]: expected an object`);
  const id = str(p, 'speciesId', `pokemon[${index}]`);
  if (!isRecord(p.baseStats)) throw new GameDataError(`${id}: missing baseStats`);
  if (!Array.isArray(p.types)) throw new GameDataError(`${id}: types must be an array`);
  const types = p.types.filter((t) => t !== 'none').map((t) => pokemonType(t, id));
  if (types.length < 1 || types.length > 2) throw new GameDataError(`${id}: must have 1 or 2 types`);

  const fastMoveIds = strArray(p, 'fastMoves', id, true);
  const chargedMoveIds = strArray(p, 'chargedMoves', id, true);
  // Existence only, not kind: the real gamemaster lists TRANSFORM (ditto) and STRUGGLE (magearna) in the
  // fast slot although their energyGain is 0 (PvPoke GameMaster.js:831 classes them "charged") and PvPoke
  // resolves species moves by id without checking the slot.
  for (const moveId of fastMoveIds) {
    if (!moves.has(moveId)) throw new GameDataError(`${id}: unknown fast move ${moveId}`);
  }
  for (const moveId of chargedMoveIds) {
    if (!moves.has(moveId)) throw new GameDataError(`${id}: unknown charged move ${moveId}`);
  }

  if (!isRecord(p.defaultIVs)) throw new GameDataError(`${id}: missing defaultIVs`);
  const iv = p.defaultIVs.cp1500;
  if (!Array.isArray(iv) || iv.length !== 4 || !iv.every((v) => typeof v === 'number')) {
    throw new GameDataError(`${id}: defaultIVs.cp1500 must be [level, atk, def, hp]`);
  }

  return {
    id,
    dex: num(p, 'dex', id),
    name: str(p, 'speciesName', id),
    types,
    base: { atk: num(p.baseStats, 'atk', id), def: num(p.baseStats, 'def', id), hp: num(p.baseStats, 'hp', id) },
    fastMoveIds,
    chargedMoveIds,
    eliteMoveIds: strArray(p, 'eliteMoves', id, false),
    tags: strArray(p, 'tags', id, false),
    nativeStatBuffs: p.nativeStatBuffs === undefined ? [0, 0] : pair(p.nativeStatBuffs, id),
    hasFormChange: p.formChange !== undefined,
    defaultIvsGreat: { level: iv[0] as number, atk: iv[1] as number, def: iv[2] as number, hp: iv[3] as number },
  };
}

/** Parse and validate a raw PvPoke gamemaster object into typed game data. */
export function loadGameData(raw: unknown): GameData {
  if (!isRecord(raw)) throw new GameDataError('gamemaster: expected an object');
  if (!Array.isArray(raw.moves)) throw new GameDataError('gamemaster: missing moves array');
  if (!Array.isArray(raw.pokemon)) throw new GameDataError('gamemaster: missing pokemon array');
  if (!isRecord(raw.settings)) throw new GameDataError('gamemaster: missing settings');

  const moves = new Map<string, Move>();
  raw.moves.forEach((m, i) => {
    const move = parseMove(m, i);
    moves.set(move.id, move);
  });

  const species = new Map<string, Species>();
  raw.pokemon.forEach((p, i) => {
    const s = parseSpecies(p, i, moves);
    species.set(s.id, s);
  });

  return {
    species,
    moves,
    maxBuffStages: num(raw.settings, 'maxBuffStages', 'settings'),
    buffDivisor: num(raw.settings, 'buffDivisor', 'settings'),
  };
}
