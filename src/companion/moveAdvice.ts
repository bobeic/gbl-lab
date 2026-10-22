import { effectiveness } from '../data/typeChart';
import type { ChargedMove, GameData, Move, MoveBuffs, StatPair } from '../data/types';
import { moveDamage, type Combatant } from '../engine/combatant';
import { PvPokeLikePolicy } from '../policy/pvpoke';
import { runMatchup } from '../sim/runMatchup';
import { countSequence } from './counts';

/** One of my charged moves against the opponent on the field. */
export interface MyMoveInfo {
  readonly id: string;
  readonly name: string;
  readonly energy: number;
  /** Fast moves needed for the 1st, 2nd and 3rd throw. */
  readonly counts: readonly number[];
  /** Damage of one unshielded hit with no buffs in play. */
  readonly damage: number;
  /** damage as a percentage of their max HP, rounded. */
  readonly percent: number;
  readonly effectiveness: number;
  readonly stab: boolean;
  /** e.g. "lowers their Attack 1 stage", or null for a move with no stat effect. */
  readonly effect: string | null;
}

/** A move's unshielded, unbuffed hit as raw damage and a rounded share of the target's max HP. */
export interface Hit {
  readonly damage: number;
  readonly percent: number;
}

export interface MoveAdvice {
  /** My fast move against them. */
  readonly fast: Hit & { readonly name: string; readonly energyGain: number; readonly turns: number };
  readonly moves: readonly MyMoveInfo[];
  /** Their fast move and charged moves against me, by move id. */
  readonly theirs: ReadonlyMap<string, Hit>;
  /** The first charged move my side throws in the simulated matchup, or null if it never throws one. */
  readonly firstThrow: string | null;
}

type Whose = 'your' | 'their';

function stageText(stages: StatPair, whose: Whose): string[] {
  return (['Attack', 'Defense'] as const).flatMap((stat, i) => {
    const n = stages[i]!;
    return n === 0 ? [] : [`${n > 0 ? 'raises' : 'lowers'} ${whose} ${stat} ${Math.abs(n)} stage${Math.abs(n) === 1 ? '' : 's'}`];
  });
}

/** A move's stat changes in words, from the side of whoever throws it (`thrower`); null for a move with none. */
export function effectText(buffs: MoveBuffs | undefined, thrower: Whose = 'your'): string | null {
  if (!buffs) return null;
  const target: Whose = thrower === 'your' ? 'their' : 'your';
  const parts = buffs.target === 'both'
    ? [...stageText(buffs.selfStages ?? [0, 0], thrower), ...stageText(buffs.opponentStages ?? [0, 0], target)]
    : stageText(buffs.stages, buffs.target === 'self' ? thrower : target);
  if (parts.length === 0) return null;
  const text = parts.join(', ');
  return buffs.chance < 1 ? `${Math.round(buffs.chance * 100)}% chance: ${text}` : text;
}

/** My charged moves' damage and side effects against this opponent, and which one the engine throws first. */
export function moveAdvice(gd: GameData, me: Combatant, opp: Combatant, shields: readonly [number, number]): MoveAdvice {
  const hit = (from: Combatant, to: Combatant, m: Move): Hit => {
    const damage = moveDamage(from, 0, to, 0, m, gd.buffDivisor);
    return { damage, percent: Math.round((100 * damage) / to.stats.hp) };
  };
  const f = me.fastMove;
  const fast = { name: f.name, energyGain: f.energyGain, turns: f.turns, ...hit(me, opp, f) };
  const theirs = new Map([opp.fastMove, ...opp.chargedMoves].map((m) => [m.id, hit(opp, me, m)]));
  const moves = me.chargedMoves.map((m: ChargedMove): MyMoveInfo => {
    return {
      id: m.id, name: m.name, energy: m.energy,
      counts: countSequence(me.fastMove.energyGain, m.energy),
      ...hit(me, opp, m),
      effectiveness: effectiveness(m.type, opp.types), stab: me.types.includes(m.type),
      effect: effectText(m.buffs),
    };
  });
  const run = runMatchup(gd, me, opp, { shields, policies: [new PvPokeLikePolicy(), new PvPokeLikePolicy()] });
  const first = run.events.find((e) => e.kind === 'charged' && e.side === 0);
  return { fast, moves, theirs, firstThrow: first?.kind === 'charged' ? first.moveId : null };
}
