import type { ChargedMove, FastMove, GameData, Move, Species } from '../data/types';
import { effectiveness } from '../data/typeChart';
import { GameDataError, StatsError, UnsupportedPokemonError } from '../errors';
import { bestLevelUnderCap, computeStats, type Ivs } from '../stats/stats';
import { SHADOW_ATK, SHADOW_DEF, STAB_MULTIPLIER } from './constants';
import { buffMultiplier, calcDamage } from './damage';

export interface PolicySettings {
  /** 0 never baits, 1 baits selectively, 2 always baits (PvPoke Pokemon.baitShields). */
  readonly baitShields: 0 | 1 | 2;
  readonly optimizeMoveTiming: boolean;
  /** Fast moves only. */
  readonly farmEnergy: boolean;
}

export interface Combatant {
  readonly species: Species;
  readonly ivs: Ivs;
  readonly level: number;
  readonly cp: number;
  readonly stats: { readonly atk: number; readonly def: number; readonly hp: number };
  readonly shadow: boolean;
  readonly fastMove: FastMove;
  readonly chargedMoves: readonly ChargedMove[];
  readonly settings: PolicySettings;
}

export interface CombatantSpec {
  readonly speciesId: string;
  readonly fastMoveId: string;
  readonly chargedMoveIds: readonly string[];
  readonly ivs?: Ivs;
  readonly level?: number;
  readonly cpCap?: number;
  readonly maxLevel?: number;
  readonly settings?: Partial<PolicySettings>;
}

const DEFAULT_SETTINGS: PolicySettings = { baitShields: 1, optimizeMoveTiming: true, farmEnergy: false };

function assertSupported(species: Species, moves: readonly Move[]): void {
  if (species.hasFormChange) throw new UnsupportedPokemonError(`${species.id} changes form in battle; not modelled yet`);
  if (species.tags.includes('mega')) throw new UnsupportedPokemonError(`${species.id} is a mega; not modelled yet`);
  for (const move of moves) {
    if (move.damageMethod !== 'default') throw new UnsupportedPokemonError(`${move.id} uses damage method ${move.damageMethod}`);
    if (move.kind === 'fast' && move.buffs) throw new UnsupportedPokemonError(`${move.id} is a fast move with buffs`);
  }
}

function resolveMove(gd: GameData, species: Species, id: string, kind: 'fast'): FastMove;
function resolveMove(gd: GameData, species: Species, id: string, kind: 'charged'): ChargedMove;
function resolveMove(gd: GameData, species: Species, id: string, kind: 'fast' | 'charged'): Move {
  const move = gd.moves.get(id);
  if (!move) throw new GameDataError(`${species.id}: unknown move ${id}`);
  if (move.kind !== kind) throw new GameDataError(`${species.id}: ${kind} move ${id} is not a ${kind} move`);
  return move;
}

function resolveLevel(species: Species, spec: CombatantSpec, ivs: Ivs, cap: number, maxLevel: number): number {
  if (spec.level !== undefined) {
    if (spec.level > maxLevel) throw new StatsError(`Level ${spec.level} exceeds max level ${maxLevel}`);
    return spec.level;
  }
  if (!spec.ivs && cap === 1500) return species.defaultIvsGreat.level;
  const level = bestLevelUnderCap(species.base, ivs, cap, maxLevel);
  if (level === null) throw new StatsError(`${species.id} ${ivs.atk}/${ivs.def}/${ivs.hp} cannot fit under ${cap} CP`);
  return level;
}

/** Build a battle-ready Pokémon from a species, moves and optional IVs/level. */
export function buildCombatant(gd: GameData, spec: CombatantSpec): Combatant {
  const species = gd.species.get(spec.speciesId);
  if (!species) throw new GameDataError(`Unknown species ${spec.speciesId}`);

  if (!species.fastMoveIds.includes(spec.fastMoveId)) {
    throw new GameDataError(`${species.id} cannot learn fast move ${spec.fastMoveId}`);
  }
  if (spec.chargedMoveIds.length < 1 || spec.chargedMoveIds.length > 2) {
    throw new GameDataError(`${species.id} needs one or two charged moves, got ${spec.chargedMoveIds.length}`);
  }
  if (new Set(spec.chargedMoveIds).size !== spec.chargedMoveIds.length) {
    throw new GameDataError(`${species.id} cannot equip the same charged move twice (${spec.chargedMoveIds.join(', ')})`);
  }
  for (const id of spec.chargedMoveIds) {
    if (!species.chargedMoveIds.includes(id)) throw new GameDataError(`${species.id} cannot learn charged move ${id}`);
  }
  const fastMove = resolveMove(gd, species, spec.fastMoveId, 'fast');
  const chargedMoves = spec.chargedMoveIds.map((id) => resolveMove(gd, species, id, 'charged'));
  assertSupported(species, [fastMove, ...chargedMoves]);

  const cap = spec.cpCap ?? 1500;
  const maxLevel = spec.maxLevel ?? 50;
  const d = species.defaultIvsGreat;
  const ivs = spec.ivs ?? (cap === 1500 ? { atk: d.atk, def: d.def, hp: d.hp } : { atk: 15, def: 15, hp: 15 });
  const level = resolveLevel(species, spec, ivs, cap, maxLevel);
  const stats = computeStats(species.base, ivs, level, species.dex);
  if (stats.cp > cap) throw new StatsError(`${species.id} at level ${level} is ${stats.cp} CP, over the ${cap} cap`);

  return {
    species,
    ivs,
    level,
    cp: stats.cp,
    stats: { atk: stats.atk, def: stats.def, hp: stats.hp },
    shadow: species.tags.includes('shadow'),
    fastMove,
    chargedMoves,
    settings: { ...DEFAULT_SETTINGS, ...spec.settings },
  };
}

/** Return attack or defense after buff stage and shadow multiplier (PvPoke Pokemon.getEffectiveStat). */
export function effectiveStat(c: Combatant, which: 'atk' | 'def', stage: number, divisor: number): number {
  let multiplier = buffMultiplier(stage, divisor);
  if (c.shadow) multiplier *= which === 'atk' ? SHADOW_ATK : SHADOW_DEF;
  return c.stats[which] * multiplier;
}

/** Compute the damage one use of a move deals given current buff stages. */
export function moveDamage(
  attacker: Combatant, attackerAtkStage: number, defender: Combatant, defenderDefStage: number, move: Move, divisor: number,
): number {
  const stab = attacker.species.types.includes(move.type) ? STAB_MULTIPLIER : 1;
  return calcDamage(
    move.power,
    stab,
    effectiveStat(attacker, 'atk', attackerAtkStage, divisor),
    effectiveStat(defender, 'def', defenderDefStage, divisor),
    effectiveness(move.type, defender.species.types),
  );
}
