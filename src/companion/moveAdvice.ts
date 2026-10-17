import { effectiveness } from '../data/typeChart';
import type { ChargedMove, GameData, MoveBuffs, StatPair } from '../data/types';
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
  /** e.g. "lowers their Attack", or null for a move with no stat effect. */
  readonly effect: string | null;
}

export interface MoveAdvice {
  readonly moves: readonly MyMoveInfo[];
  /** The first charged move my side throws in the simulated matchup, or null if it never throws one. */
  readonly firstThrow: string | null;
}

function stageText(stages: StatPair, whose: 'your' | 'their'): string[] {
  return (['Attack', 'Defense'] as const).flatMap((stat, i) =>
    stages[i] === 0 ? [] : [`${stages[i]! > 0 ? 'raises' : 'lowers'} ${whose} ${stat}`]);
}

function effectText(buffs: MoveBuffs | undefined): string | null {
  if (!buffs) return null;
  const parts = buffs.target === 'both'
    ? [...stageText(buffs.selfStages ?? [0, 0], 'your'), ...stageText(buffs.opponentStages ?? [0, 0], 'their')]
    : stageText(buffs.stages, buffs.target === 'self' ? 'your' : 'their');
  if (parts.length === 0) return null;
  const text = parts.join(', ');
  return buffs.chance < 1 ? `${Math.round(buffs.chance * 100)}% chance: ${text}` : text;
}

/** My charged moves' damage and side effects against this opponent, and which one the engine throws first. */
export function moveAdvice(gd: GameData, me: Combatant, opp: Combatant, shields: readonly [number, number]): MoveAdvice {
  const moves = me.chargedMoves.map((m: ChargedMove): MyMoveInfo => {
    const damage = moveDamage(me, 0, opp, 0, m, gd.buffDivisor);
    return {
      id: m.id, name: m.name, energy: m.energy,
      counts: countSequence(me.fastMove.energyGain, m.energy),
      damage, percent: Math.round((100 * damage) / opp.stats.hp),
      effectiveness: effectiveness(m.type, opp.types), stab: me.types.includes(m.type),
      effect: effectText(m.buffs),
    };
  });
  const run = runMatchup(gd, me, opp, { shields, policies: [new PvPokeLikePolicy(), new PvPokeLikePolicy()] });
  const first = run.events.find((e) => e.kind === 'charged' && e.side === 0);
  return { moves, firstThrow: first?.kind === 'charged' ? first.moveId : null };
}
