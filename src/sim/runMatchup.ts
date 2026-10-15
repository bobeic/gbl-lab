import type { GameData } from '../data/types';
import type { Combatant } from '../engine/combatant';
import { TurnLimitError } from '../errors';
import { createBattle, SIDES, type Side } from '../engine/state';
import { beginTurn, canAct, resolveTurn, type Action, type BattleEvent } from '../engine/turn';
import type { Policy } from '../policy/types';
import { battleRating } from './rating';

export interface MatchupOptions {
  readonly shields: readonly [number, number];
  readonly startEnergy?: readonly [number, number];
  readonly policies: readonly [Policy, Policy];
  readonly maxTurns?: number;
}

export interface MatchupResult {
  readonly winner: Side | null;
  readonly ratings: [number, number];
  readonly hp: [number, number];
  readonly energy: [number, number];
  readonly shields: [number, number];
  readonly turns: number;
  readonly events: BattleEvent[];
}

/** Simulate a 1v1 until a faint and return ratings, final state and the event log. */
export function runMatchup(gd: GameData, a: Combatant, b: Combatant, options: MatchupOptions): MatchupResult {
  const maxTurns = options.maxTurns ?? 1000;
  let state = createBattle([a, b], { shields: options.shields, startEnergy: options.startEnergy }, {
    maxBuffStages: gd.maxBuffStages, buffDivisor: gd.buffDivisor,
  });
  const events: BattleEvent[] = [];
  const [p0, p1] = options.policies;
  const policies = [p0, p1];

  while (!state.over) {
    if (state.turn > maxTurns) throw new TurnLimitError(`Battle exceeded ${maxTurns} turns`, events);
    const pre = beginTurn(state);
    const actions = SIDES.map((side) => (canAct(pre, side) ? policies[side]!.chooseAction(pre, side) : null)) as [Action | null, Action | null];
    const result = resolveTurn(pre, actions, (s, defender, idx, dmg) => policies[defender]!.chooseShield(s, defender, idx, dmg));
    events.push(...result.events);
    state = result.state;
  }

  const [s0, s1] = state.sides;
  const ratings: [number, number] = [
    battleRating(s0.hp, a.stats.hp, s1.hp, b.stats.hp),
    battleRating(s1.hp, b.stats.hp, s0.hp, a.stats.hp),
  ];
  return {
    winner: ratings[0] > ratings[1] ? 0 : ratings[1] > ratings[0] ? 1 : null,
    ratings,
    hp: [s0.hp, s1.hp],
    energy: [s0.energy, s1.energy],
    shields: [s0.shields, s1.shields],
    turns: state.turn - 1,
    events,
  };
}
