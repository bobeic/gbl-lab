import { effectiveness } from '../data/typeChart';
import type { Move } from '../data/types';
import type { Combatant } from '../engine/combatant';

const joinNames = (names: readonly string[]): string => names.join(' and ');

/** A short line for when the type chart alone would mislead about this matchup, or null. */
export function typeReason(me: Combatant, opp: Combatant, rating: number): string | null {
  const mult = (m: Move): number => effectiveness(m.type, me.types);
  const fast = opp.fastMove;
  const fastSuper = mult(fast) > 1;
  if (fastSuper && rating >= 500) {
    const resisted = opp.chargedMoves.filter((m) => mult(m) < 1).map((m) => m.name);
    const lead = `Takes super-effective ${fast.name}, but`;
    if (resisted.length === 0) return `${lead} wins on bulk and pressure`;
    if (resisted.length === opp.chargedMoves.length && resisted.length > 1) return `${lead} resists both charged moves`;
    return `${lead} resists ${joinNames(resisted)}`;
  }
  if (rating < 450 && [fast, ...opp.chargedMoves].every((m) => mult(m) <= 1)) {
    return 'Loses despite resisting or taking neutral damage: their bulk and pressure win';
  }
  return fastSuper ? `Takes super-effective ${fast.name}` : null;
}
