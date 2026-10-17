import type { FormChange, Move, MoveBuffs, StatPair } from '../data/types';
import { GameDataError, IllegalActionError } from '../errors';
import { formOf, moveDamage, withForm, type Combatant } from './combatant';
import { MAX_ENERGY, TURN_MS } from './constants';
import { clampStage } from './damage';
import { SIDES, initialMeter, other, type BattleState, type QueuedAction, type Side, type SideState } from './state';

export type Action = { readonly type: 'fast' } | { readonly type: 'charged'; readonly index: number } | { readonly type: 'wait' };

export type ShieldDecider = (state: BattleState, defender: Side, moveIndex: number, damage: number) => boolean;

export type BattleEvent =
  | { readonly kind: 'fast'; readonly turn: number; readonly side: Side; readonly moveId: string; readonly damage: number; readonly energyGained: number }
  | { readonly kind: 'charged'; readonly turn: number; readonly side: Side; readonly moveId: string; readonly damage: number; readonly shielded: boolean }
  | { readonly kind: 'buff'; readonly turn: number; readonly side: Side; readonly stages: StatPair; readonly sourceMoveId: string }
  | { readonly kind: 'disguise'; readonly turn: number; readonly side: Side; readonly blockedDamage: number; readonly sourceMoveId: string }
  | { readonly kind: 'formChange'; readonly turn: number; readonly side: Side; readonly from: string; readonly to: string }
  | { readonly kind: 'faint'; readonly turn: number; readonly side: Side };

/** Start a turn: tick both cooldowns down by one turn. */
export function beginTurn(state: BattleState): BattleState {
  const tick = (s: SideState): SideState => ({ ...s, cooldownMs: Math.max(0, s.cooldownMs - TURN_MS) });
  return { ...state, sides: [tick(state.sides[0]), tick(state.sides[1])] };
}

/** Whether a side may choose an action this turn. */
export function canAct(state: BattleState, side: Side): boolean {
  const me = state.sides[side];
  const opp = state.sides[other(side)];
  return !state.over && !state.chargedLastTurn && me.cooldownMs === 0 && me.hp > 0 && opp.hp > 0;
}

/** Add buff stages to a stat pair, clamping each to the max (PvPoke Pokemon.applyStatBuffs). */
export function addStages(current: StatPair, delta: StatPair, max: number): StatPair {
  return [clampStage(current[0] + delta[0], max), clampStage(current[1] + delta[1], max)];
}

/** Return a 'both'-target move's self or opponent stages, failing if the data omits them. */
export function requireStages(stages: StatPair | undefined, moveId: string): StatPair {
  if (!stages) throw new GameDataError(`${moveId}: 'both' buff target is missing its self/opponent stages`);
  return stages;
}

/** Stage changes a buff move applies to the opponent and to its user (null when that target is untouched). */
function buffDeltas(buffs: MoveBuffs, moveId: string): { opponent: StatPair | null; self: StatPair | null } {
  switch (buffs.target) {
    case 'opponent': return { opponent: buffs.stages, self: null };
    case 'self': return { opponent: null, self: buffs.stages };
    case 'both': return { opponent: requireStages(buffs.opponentStages, moveId), self: requireStages(buffs.selfStages, moveId) };
  }
}

/** Whether a rule is Mimikyu's Disguise: it takes an unshielded charged move like a shield. */
function isDisguise(rule: FormChange | null): boolean {
  return rule?.trigger === 'charged_move_damage' && rule.effect === 'protect';
}

/** Resolve a turn given each side's chosen action (null when it cannot or does not act). */
export function resolveTurn(
  state: BattleState, actions: readonly [Action | null, Action | null], decideShield: ShieldDecider,
): { state: BattleState; events: BattleEvent[] } {
  if (state.over) throw new IllegalActionError(`Battle is already over at turn ${state.turn}`);
  const { combatants, rules } = state;
  const sides: [SideState, SideState] = [state.sides[0], state.sides[1]];
  const events: BattleEvent[] = [];
  const queue: QueuedAction[] = [...state.queue];
  const cooldowns: [number, number] = [sides[0].cooldownMs, sides[1].cooldownMs];
  const active = (side: Side): Combatant => withForm(combatants[side], sides[side].formId);

  // PvPoke Pokemon.changeForm and resetMoves (Pokemon.js:2471-2526, 711-750, 880-900): new types and moves,
  // native stat stages added, buff meters reset, and the changing side's move damage recomputed at current stages.
  const changeForm = (side: Side, to: string): void => {
    const from = sides[side].formId;
    if (from === to) return;
    const form = formOf(combatants[side], to);
    const buffs = addStages(sides[side].buffs, form.nativeStatBuffs, rules.maxBuffStages);
    sides[side] = { ...sides[side], formId: to, buffs, buffMeters: form.chargedMoves.map((m) => initialMeter(m.buffs?.chance)) };
    const me = active(side);
    const opp = active(other(side));
    const dmg = (m: Move): number => moveDamage(me, sides[side].buffs[0], opp, sides[other(side)].buffs[1], m, rules.buffDivisor);
    const charged = me.chargedMoves.map(dmg);
    sides[side] = { ...sides[side], lastDamage: { fast: dmg(me.fastMove), charged }, moveOrderBasis: charged };
    events.push({ kind: 'formChange', turn: state.turn, side, from, to });
  };

  for (const side of SIDES) {
    const action = actions[side];
    if (!action) continue;
    if (!canAct(state, side)) throw new IllegalActionError(`Side ${side} cannot act on turn ${state.turn}`);
    let chargedIndex = -1;
    let priority = 0;
    if (action.type === 'fast') {
      cooldowns[side] += combatants[side].fastMove.cooldownMs;
    } else if (action.type === 'charged') {
      const move = active(side).chargedMoves[action.index];
      if (!move) throw new IllegalActionError(`Side ${side} has no charged move ${action.index}`);
      if (sides[side].energy < move.energy) {
        throw new IllegalActionError(`Side ${side} has ${sides[side].energy} energy, ${move.id} needs ${move.energy}`);
      }
      chargedIndex = action.index;
      cooldowns[side] += TURN_MS;
      // PvPoke Battle.getTurnAction (Battle.js:771-778): charged +10, +1 for higher raw attack (CMP)
      priority = 10 + (combatants[side].stats.atk > combatants[other(side)].stats.atk ? 1 : 0);
    }
    queue.push({ type: action.type, actor: side, turn: state.turn, chargedIndex, priority });
  }
  sides[0] = { ...sides[0], cooldownMs: cooldowns[0] };
  sides[1] = { ...sides[1], cooldownMs: cooldowns[1] };

  const turnActions: QueuedAction[] = [];
  const remaining: QueuedAction[] = [];
  for (const q of queue) {
    const eligible = q.type !== 'fast'
      || (state.turn - q.turn) * TURN_MS >= combatants[q.actor].fastMove.cooldownMs - TURN_MS
      || (state.chargedLastTurn && q.turn < state.turn);
    (eligible ? turnActions : remaining).push(q);
  }
  turnActions.sort((a, b) => b.priority - a.priority);

  const snapshot = (): BattleState => ({ ...state, sides: [sides[0], sides[1]] });
  let chargedUsed = 0;

  // Indexed so an action spliced in after the current one (Gulp Missile) runs next (PvPoke Battle.js:432-438)
  for (let i = 0; i < turnActions.length; i++) {
    const act = turnActions[i]!;
    const me = act.actor;
    const op = other(me);
    const attacker = active(me);
    const defender = active(op);

    if (act.type === 'fast') {
      if (sides[op].hp < 1) continue;
      if (sides[me].hp < 1 && sides[me].faintSource === 'charged') continue;
      const move = attacker.fastMove;
      const damage = moveDamage(attacker, sides[me].buffs[0], defender, sides[op].buffs[1], move, rules.buffDivisor);
      sides[me] = {
        ...sides[me],
        energy: Math.min(MAX_ENERGY, sides[me].energy + move.energyGain),
        lastDamage: { ...sides[me].lastDamage, fast: damage },
      };
      const hp = Math.max(0, sides[op].hp - damage);
      sides[op] = { ...sides[op], hp, faintSource: hp <= 0 ? 'fast' : sides[op].faintSource };
      events.push({ kind: 'fast', turn: state.turn, side: me, moveId: move.id, damage, energyGained: move.energyGain });
    } else if (act.type === 'charged') {
      const idx = act.chargedIndex;
      const move = act.extraMove ?? attacker.chargedMoves[idx]!;
      if (sides[me].energy < move.energy) continue;
      if (state.usePriority && sides[me].hp <= 0 && sides[me].faintSource === 'charged' && !move.tags.includes('ignoresFaint')) continue;

      let damage = moveDamage(attacker, sides[me].buffs[0], defender, sides[op].buffs[1], move, rules.buffDivisor);
      const charged = [...sides[me].lastDamage.charged];
      if (idx >= 0) charged[idx] = damage;
      sides[me] = { ...sides[me], energy: sides[me].energy - move.energy, lastDamage: { ...sides[me].lastDamage, charged } };

      let shielded = false;
      if (sides[op].shields > 0 && !move.tags.includes('instant') && decideShield(snapshot(), op, idx, damage)) {
        shielded = true;
        damage = 1;
        sides[op] = { ...sides[op], shields: sides[op].shields - 1 };
      }
      // PvPoke Battle.js:1273-1300: Mimikyu's Disguise takes an unshielded, non-instant charged move like a shield
      const disguised = !shielded && !move.tags.includes('instant') && isDisguise(formOf(combatants[op], sides[op].formId).formChange);
      const blockedDamage = damage;
      if (disguised) damage = 1;
      const hp = Math.max(0, sides[op].hp - damage);
      sides[op] = { ...sides[op], hp, faintSource: hp <= 0 ? 'charged' : sides[op].faintSource };
      events.push({ kind: 'charged', turn: state.turn, side: me, moveId: move.id, damage, shielded });
      if (disguised) events.push({ kind: 'disguise', turn: state.turn, side: op, blockedDamage, sourceMoveId: move.id });
      chargedUsed++;

      const buffs = move.buffs;
      if (buffs) {
        let applies = buffs.chance === 1;
        const meter = idx >= 0 ? sides[me].buffMeters[idx] : null;
        if (buffs.chance < 1 && meter !== null && meter !== undefined) {
          // PvPoke Battle.js:1401-1410 deterministic buff meter
          const next = meter + buffs.chance;
          applies = Math.floor(next) > Math.floor(meter);
          const meters = [...sides[me].buffMeters];
          meters[idx] = next;
          sides[me] = { ...sides[me], buffMeters: meters };
        }
        if (applies) {
          const deltas = buffDeltas(buffs, move.id);
          // PvPoke applies the opponent target before the self target (Battle.js:1425-1448)
          if (deltas.opponent) {
            sides[op] = { ...sides[op], buffs: addStages(sides[op].buffs, deltas.opponent, rules.maxBuffStages) };
            events.push({ kind: 'buff', turn: state.turn, side: op, stages: deltas.opponent, sourceMoveId: move.id });
          }
          if (deltas.self) {
            sides[me] = { ...sides[me], buffs: addStages(sides[me].buffs, deltas.self, rules.maxBuffStages) };
            events.push({ kind: 'buff', turn: state.turn, side: me, stages: deltas.self, sourceMoveId: move.id });
          }
        }
      }
      // PvPoke Battle.js:1547-1580: the attacker changes form after a matching charged move (Morpeko, Cramorant)
      const attackerRule = formOf(combatants[me], sides[me].formId).formChange;
      if (attackerRule?.trigger === 'charged_move' && attackerRule.alternativeFormId !== null
        && (attackerRule.moveId === 'ANY' || attackerRule.moveId === move.id || attackerRule.moveIds?.includes(move.id))) {
        // PvPoke Battle.js:1555-1566: Cramorant's 'variable' target resolves by HP after the move
        const to = attackerRule.alternativeFormId !== 'variable' ? attackerRule.alternativeFormId
          : sides[me].hp / combatants[me].stats.hp > 0.5 ? 'cramorant_gulping' : 'cramorant_gorging';
        changeForm(me, to);
      }
      // PvPoke Battle.js:1583-1617: a gulping/gorging defender hit by an unshielded, non-instant charged move fires Gulp Missile next
      const extraMove = formOf(combatants[op], sides[op].formId).gulpMissile;
      if (extraMove && !shielded && !move.tags.includes('instant')) {
        turnActions.splice(i + 1, 0, { type: 'charged', actor: op, turn: state.turn, chargedIndex: -1, priority: 0, extraMove });
      }
      // PvPoke Battle.js:1621-1633: the defender changes form after an unshielded, non-instant charged move (Mimikyu's bust)
      const defenderRule = formOf(combatants[op], sides[op].formId).formChange;
      if (defenderRule?.trigger === 'charged_move_damage' && defenderRule.alternativeFormId !== null
        && !shielded && !move.tags.includes('instant')) {
        changeForm(op, defenderRule.alternativeFormId);
      }
    }
  }

  if (chargedUsed > 0) {
    sides[0] = { ...sides[0], cooldownMs: TURN_MS };
    sides[1] = { ...sides[1], cooldownMs: TURN_MS };
  }
  for (const side of SIDES) {
    if (sides[side].hp <= 0) events.push({ kind: 'faint', turn: state.turn, side });
  }

  return {
    state: {
      ...state,
      sides,
      queue: remaining,
      turn: state.turn + 1,
      chargedLastTurn: turnActions.some((a) => a.type === 'charged'),
      over: sides[0].hp <= 0 || sides[1].hp <= 0,
    },
    events,
  };
}
