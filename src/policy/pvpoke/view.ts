import type { ChargedMove, FastMove } from '../../data/types';
import type { Combatant, Form } from '../../engine/combatant';
import { activeCombatant, activeForm, other, type BattleState, type Side, type SideState } from '../../engine/state';
import { PolicyStateError } from '../../errors';
import { orderChargedMoves } from './moveMeta';

/** Read-only, PvPoke-shaped view of one side, so the port reads like the original. */
export interface PokeView {
  readonly side: Side;
  readonly c: Combatant;
  readonly s: SideState;
  /** The side's active form, including its form-change rule (PvPoke activeFormId / formChange). */
  readonly form: Form;
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

/** Build one side's view from its active form and its move-order basis. */
function buildView(state: BattleState, side: Side): PokeView {
  const c = activeCombatant(state, side);
  const s = state.sides[side];
  const order = orderChargedMoves(c, s.moveOrderBasis, state.rules.buffDivisor);
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

  // PvPoke Pokemon.js:842-846 overwrites every active move's dpe with damage / energy whenever resetMoves runs:
  // at Battle.start and at each form change. Nothing else recomputes it in simulate mode.
  const dpeOf = (move: ChargedMove): number => {
    const damage = s.moveOrderBasis[indexOf(move)];
    if (damage === undefined) throw new PolicyStateError(`${c.species.id}: no move-order damage for ${move.id}`);
    return damage / move.energy;
  };

  return {
    side, c, s, form: activeForm(state, side), fastMove: c.fastMove, chargedMoves,
    activeChargedMoves: order.active, bestChargedMove: order.best, fastestChargedMove: order.fastest,
    indexOf, damageOf, dpeOf,
  };
}

/** Build the PvPoke-shaped views for both sides of a battle, in their active forms. */
export function views(state: BattleState, me: Side): { poke: PokeView; opponent: PokeView } {
  return { poke: buildView(state, me), opponent: buildView(state, other(me)) };
}
