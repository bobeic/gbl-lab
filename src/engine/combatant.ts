import type { ChargedMove, FastMove, FormChange, GameData, Move, PokemonType, Species, StatPair } from '../data/types';
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

/** One in-battle form of a Pokémon (PvPoke activeFormId); every form shares the Combatant's stats. */
export interface Form {
  readonly id: string;
  readonly types: readonly PokemonType[];
  /** Charged moves in slot order, with this form's move swaps applied. */
  readonly chargedMoves: readonly ChargedMove[];
  /** Stat stages added when the Pokémon enters this form (PvPoke nativeStatBuffs). */
  readonly nativeStatBuffs: StatPair;
  /** The rule in force in this form; a form without its own keeps the previous one (PvPoke Pokemon.js:2482-2484). */
  readonly formChange: FormChange | null;
}

export interface Combatant {
  readonly species: Species;
  /** Types in the start form; during a battle read them through activeCombatant/withForm. */
  readonly types: readonly PokemonType[];
  readonly startFormId: string;
  /** Every form reachable from the start form, keyed by form id (a single entry for most Pokémon). */
  readonly forms: ReadonlyMap<string, Form>;
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
  if (species.tags.includes('mega')) throw new UnsupportedPokemonError(`${species.id} is a mega; not modelled yet`);
  for (const move of moves) {
    if (move.damageMethod !== 'default') throw new UnsupportedPokemonError(`${move.id} uses damage method ${move.damageMethod}`);
    if (move.kind === 'fast' && move.buffs) throw new UnsupportedPokemonError(`${move.id} is a fast move with buffs`);
  }
}

/** Reject a battle-only form (e.g. morpeko_hangry), naming the released form that turns into it. */
function assertNotBattleOnly(gd: GameData, species: Species): void {
  if (species.released) return;
  for (const s of gd.species.values()) {
    if (s.released && s.formChange?.alternativeFormId === species.id) {
      throw new GameDataError(`${species.id} is a battle-only form; use ${s.id}`);
    }
  }
}

/** Moves replaced when entering a form, as PvPoke Pokemon.changeForm hard-codes them (Pokemon.js:2504-2511). */
const FORM_MOVE_SWAPS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  morpeko_full_belly: { AURA_WHEEL_DARK: 'AURA_WHEEL_ELECTRIC' },
  morpeko_hangry: { AURA_WHEEL_ELECTRIC: 'AURA_WHEEL_DARK' },
};

function swapMoves(gd: GameData, formId: string, moves: readonly ChargedMove[]): ChargedMove[] {
  const swaps = FORM_MOVE_SWAPS[formId] ?? {};
  return moves.map((m) => {
    const to = swaps[m.id];
    if (to === undefined) return m;
    const move = gd.moves.get(to);
    if (!move || move.kind !== 'charged') throw new GameDataError(`${formId}: swap target ${to} is not a charged move`);
    return move;
  });
}

/** Whether the engine models a rule: Morpeko's switch, Mimikyu's Disguise, or no further change. */
function isSupportedRule(rule: FormChange): boolean {
  if (rule.trigger === 'none') return true;
  if (rule.trigger === 'charged_move') return rule.moveId === 'ANY' && rule.moveIds === null && rule.alternativeFormId !== 'variable';
  return rule.trigger === 'charged_move_damage' && rule.effect === 'protect';
}

/** Follow alternativeFormId from the start form and build every reachable form, rejecting what is not modelled. */
function buildForms(gd: GameData, start: Species, startMoves: readonly ChargedMove[]): Map<string, Form> {
  const forms = new Map<string, Form>();
  let species = start;
  let moves: readonly ChargedMove[] = startMoves;
  let rule: FormChange | null = start.formChange;
  for (;;) {
    if (rule && !isSupportedRule(rule)) {
      throw new UnsupportedPokemonError(`${start.id}: form change (${rule.trigger} -> ${rule.alternativeFormId ?? 'none'}) is not modelled yet`);
    }
    // PvPoke recomputes stats for a form with different base stats (Pokemon.getFormStats); only Aegislash needs that.
    if (species.base.atk !== start.base.atk || species.base.def !== start.base.def || species.base.hp !== start.base.hp) {
      throw new UnsupportedPokemonError(`${start.id}: form ${species.id} has different base stats; not modelled yet`);
    }
    forms.set(species.id, { id: species.id, types: species.types, chargedMoves: moves, nativeStatBuffs: species.nativeStatBuffs, formChange: rule });
    const nextId = rule && rule.trigger !== 'none' ? rule.alternativeFormId : null;
    if (nextId === null || forms.has(nextId)) return forms;
    const next = gd.species.get(nextId);
    if (!next) throw new GameDataError(`${species.id}: form change target ${nextId} is not a known species`);
    species = next;
    moves = swapMoves(gd, nextId, moves);
    rule = next.formChange ?? rule;
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
  assertNotBattleOnly(gd, species);

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
  const forms = buildForms(gd, species, chargedMoves);

  const cap = spec.cpCap ?? 1500;
  const maxLevel = spec.maxLevel ?? 50;
  const d = species.defaultIvsGreat;
  const ivs = spec.ivs ?? (cap === 1500 ? { atk: d.atk, def: d.def, hp: d.hp } : { atk: 15, def: 15, hp: 15 });
  const level = resolveLevel(species, spec, ivs, cap, maxLevel);
  const stats = computeStats(species.base, ivs, level, species.dex);
  if (stats.cp > cap) throw new StatsError(`${species.id} at level ${level} is ${stats.cp} CP, over the ${cap} cap`);

  return {
    species,
    types: species.types,
    startFormId: species.id,
    forms,
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

/** Return one of the combatant's forms, failing loudly if it has no such form. */
export function formOf(c: Combatant, formId: string): Form {
  const form = c.forms.get(formId);
  if (!form) throw new GameDataError(`${c.species.id} has no form ${formId}`);
  return form;
}

/** Return the combatant as it is in `formId`: that form's types and charged moves, everything else unchanged. */
export function withForm(c: Combatant, formId: string): Combatant {
  if (formId === c.startFormId) return c;
  const form = formOf(c, formId);
  return { ...c, types: form.types, chargedMoves: form.chargedMoves };
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
  const stab = attacker.types.includes(move.type) ? STAB_MULTIPLIER : 1;
  return calcDamage(
    move.power,
    stab,
    effectiveStat(attacker, 'atk', attackerAtkStage, divisor),
    effectiveStat(defender, 'def', defenderDefStage, divisor),
    effectiveness(move.type, defender.types),
  );
}
