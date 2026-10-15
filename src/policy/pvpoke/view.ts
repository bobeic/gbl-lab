import type { ChargedMove, FastMove } from '../../data/types';
import type { Combatant } from '../../engine/combatant';
import { createBattle, other, type BattleState, type Side, type SideState } from '../../engine/state';
import { PolicyStateError } from '../../errors';
import { orderChargedMoves } from './moveMeta';

/** Read-only, PvPoke-shaped view of one side, so the port reads like the original. */
export interface PokeView {
  readonly side: Side;
  readonly c: Combatant;
  readonly s: SideState;
  readonly fastMove: FastMove;
  /** PvPoke this.chargedMoves in slot order: the same move objects as activeChargedMoves (incl. resetMoves rewrites). */
  readonly chargedMoves: readonly ChargedMove[];
  /** Charged moves sorted/prioritised as PvPoke Pokemon.resetMoves (Pokemon.js:711-875). */
  readonly activeChargedMoves: readonly ChargedMove[];
  readonly bestChargedMove: ChargedMove | null;
  readonly fastestChargedMove: ChargedMove | null;
  /** Indexes into chargedMoves for activeChargedMoves entries. */
  indexOf(move: ChargedMove): number;
  /** PvPoke move.damage for this move against the opponent, from SideState.lastDamage. */
  damageOf(move: FastMove | ChargedMove): number;
  /** PvPoke move.dpe after Battle.start: start-of-battle damage / energy (Pokemon.js:842-846). */
  dpeOf(move: ChargedMove): number;
}

/** Build one side's view; `start` is the battle's start-of-battle state, where PvPoke's resetMoves runs. */
function buildView(state: BattleState, start: BattleState, side: Side): PokeView {
  const c = state.combatants[side];
  const s = state.sides[side];
  const startDamage = start.sides[side].lastDamage.charged;
  const order = orderChargedMoves(c, start.sides[side], state.rules.buffDivisor);
  const chargedMoves = c.chargedMoves.map((m) => {
    const found = order.active.find((a) => a.id === m.id);
    if (!found) throw new PolicyStateError(`${c.species.id}: ${m.id} missing from its ordered charged moves`);
    return found;
  });

  const indexOf = (move: ChargedMove): number => {
    const i = chargedMoves.findIndex((m) => m.id === move.id);
    if (i < 0) throw new PolicyStateError(`${c.species.id} does not know charged move ${move.id}`);
    return i;
  };

  const damageOf = (move: FastMove | ChargedMove): number => {
    if (move.kind === 'fast') {
      if (move.id !== c.fastMove.id) throw new PolicyStateError(`${c.species.id} does not know fast move ${move.id}`);
      return s.lastDamage.fast;
    }
    const damage = s.lastDamage.charged[indexOf(move)];
    if (damage === undefined) throw new PolicyStateError(`${c.species.id}: no damage recorded for ${move.id}`);
    return damage;
  };

  // PvPoke Pokemon.js:842-846 overwrites every active move's dpe with damage / energy at Battle.start;
  // nothing recomputes it during a simulate-mode battle, so later move.damage changes do not reach it.
  const dpeOf = (move: ChargedMove): number => {
    const damage = startDamage[indexOf(move)];
    if (damage === undefined) throw new PolicyStateError(`${c.species.id}: no start damage for ${move.id}`);
    return damage / move.energy;
  };

  return {
    side, c, s, fastMove: c.fastMove, chargedMoves,
    activeChargedMoves: order.active, bestChargedMove: order.best, fastestChargedMove: order.fastest,
    indexOf, damageOf, dpeOf,
  };
}

/** Build the PvPoke-shaped views for both sides of a battle. */
export function views(state: BattleState, me: Side): { poke: PokeView; opponent: PokeView } {
  // PvPoke Battle.start (Battle.js:238-245) runs resetMoves with native buffs; createBattle reproduces that state.
  const start = createBattle(state.combatants, { shields: [0, 0] }, state.rules);
  return { poke: buildView(state, start, me), opponent: buildView(state, start, other(me)) };
}
