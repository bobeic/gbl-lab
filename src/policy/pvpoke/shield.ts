import type { ChargedMove, StatPair } from '../../data/types';
import { moveDamage } from '../../engine/combatant';
import { other, type BattleRules, type BattleState, type Side } from '../../engine/state';
import { addStages, requireStages } from '../../engine/turn';
import { PolicyStateError } from '../../errors';
import { views, type PokeView } from './view';

/**
 * Decide whether the defender would shield `move`, as PvPoke ActionLogic.wouldShield does in simulate mode.
 * `damage` is the value PvPoke writes to move.damage (ActionLogic.js:1159) for callers that must mirror it.
 */
export function wouldShield(
  state: BattleState, attackerSide: Side, defenderSide: Side, move: ChargedMove,
): { value: boolean; damage: number } {
  if (defenderSide !== other(attackerSide)) throw new PolicyStateError(`Side ${defenderSide} is not side ${attackerSide}'s opponent`);
  const { poke: attacker, opponent: defender } = views(state, attackerSide);
  return wouldShieldViews(attacker, defender, move, state.rules);
}

/** `wouldShield` on prebuilt views, for callers (decideAction) that ask it repeatedly about one state. */
export function wouldShieldViews(
  attacker: PokeView, defender: PokeView, move: ChargedMove, rules: BattleRules,
): { value: boolean; damage: number } {
  if (defender.side !== other(attacker.side)) throw new PolicyStateError(`Side ${defender.side} is not side ${attacker.side}'s opponent`);
  const { maxBuffStages, buffDivisor } = rules;

  // PvPoke ActionLogic.js:1154-1161 (shield weights only feed decisionMethod "random"; skipped throughout)
  let useShield = false;
  const damage = moveDamage(attacker.c, attacker.s.buffs[0], defender.c, defender.s.buffs[1], move, buffDivisor);

  const postMoveHP = defender.s.hp - damage; // How much HP will be left after the attack

  // PvPoke ActionLogic.js:1163-1176: apply the move's buffs to local copies (PvPoke mutates, then resets)
  let attackerBuffs: StatPair = attacker.s.buffs;
  let defenderBuffs: StatPair = defender.s.buffs;
  let moveBuffs: StatPair = [0, 0];

  if (move.buffs) {
    moveBuffs = move.buffs.stages;
  }

  if (moveBuffs[0] > 0) {
    attackerBuffs = addStages(attackerBuffs, moveBuffs, maxBuffStages);
  } else {
    defenderBuffs = addStages(defenderBuffs, moveBuffs, maxBuffStages);
  }

  const fastDamage = moveDamage(attacker.c, attackerBuffs[0], defender.c, defenderBuffs[1], attacker.fastMove, buffDivisor);

  // PvPoke ActionLogic.js:1180-1189: will the defender survive to shield the next cycle?
  const fastAttacks = Math.ceil((move.energy - Math.max(attacker.s.energy - move.energy, 0)) / attacker.fastMove.energyGain) + 1;
  const fastAttackDamage = fastAttacks * fastDamage;
  const cycleDamage = (fastAttackDamage + 1) * defender.s.shields;

  if (postMoveHP <= cycleDamage) {
    useShield = true;
  }

  // PvPoke ActionLogic.js:1191-1197: buffs reset (the local copies above are simply not used again)

  // PvPoke ActionLogic.js:1198-1224: block if a charged move connecting would cost too much
  const fastDPT = fastDamage / attacker.fastMove.turns;

  for (const chargedMove of attacker.chargedMoves) {
    // Verbatim PvPoke condition; always true for non-negative energy.
    if (attacker.s.energy + chargedMove.energy >= chargedMove.energy) {
      const chargedDamage = moveDamage(attacker.c, attacker.s.buffs[0], defender.c, defender.s.buffs[1], chargedMove, buffDivisor);

      if (chargedDamage >= defender.s.hp / 1.4 && fastDPT > 1.5) {
        useShield = true;
      }

      if (chargedDamage >= defender.s.hp - cycleDamage) {
        useShield = true;
      }
    }
  }

  // PvPoke ActionLogic.js:1227-1231: shield the first of a series of attack-debuffing moves if it hits hard
  if (move.selfAttackDebuffing && damage / defender.s.hp > 0.55) {
    useShield = true;
  }

  // PvPoke ActionLogic.js:1233-1236: an always-baiting attacker is always shielded in simulate mode
  if (attacker.c.settings.baitShields === 2) {
    useShield = true;
  }

  // PvPoke ActionLogic.js:1238-1257 skipped: Aegislash and Cramorant form branches (form changes unsupported).

  return { value: useShield, damage };
}

/** Decide whether `me` shields the opponent's incoming charged move, as PvPoke Battle.useMove does in simulate mode. */
export function pvpokeShield(state: BattleState, me: Side, incomingMoveIndex: number, damage: number): boolean {
  const attackerSide = other(me);
  const { poke: defender, opponent: attacker } = views(state, me);
  const move = attacker.chargedMoves[incomingMoveIndex];
  if (!move) throw new PolicyStateError(`Side ${attackerSide} has no charged move ${incomingMoveIndex}`);
  // PvPoke Battle.js:1038-1039 sets move.damage to the dealt damage before deciding; the snapshot must agree.
  if (damage !== attacker.damageOf(move)) {
    throw new PolicyStateError(`${move.id}: damage ${damage} disagrees with the snapshot's ${attacker.damageOf(move)}`);
  }

  // PvPoke Battle.js:1075-1081 (canShield is checked by the engine; simulate mode is never sandboxed)
  let useShield = true;
  const shieldDecision = wouldShieldViews(attacker, defender, move, state.rules);

  // PvPoke Battle.js:1083-1095: don't shield early PUPs, Acid Sprays, or similar moves
  if (move.buffs && move.selfBuffing) {
    if ((move.buffs.target === 'self' && move.buffs.stages[0] > 0)
      || (move.buffs.target === 'opponent' && move.buffs.stages[1] < 0)) {
      useShield = shieldDecision.value;
    }

    // For moves with multiple targets
    if (move.buffs.target === 'both' && (requireStages(move.buffs.selfStages, move.id)[0] > 0
      || requireStages(move.buffs.opponentStages, move.id)[1] < 0)) {
      useShield = shieldDecision.value;
    }
  }

  // PvPoke Battle.js:1097-1120: don't shield early moves if the defender's best move lowers its own defense
  if (defender.bestChargedMove && defender.bestChargedMove.selfDefenseDebuffing) {
    if (attacker.s.shields > 0) {
      useShield = shieldDecision.value;
    } else if (defender.bestChargedMove && attacker.bestChargedMove) {
      // Shield this attack if the defender's next move will knock out the shieldless attacker
      const fastToNextCharged = Math.ceil((defender.bestChargedMove.energy - defender.s.energy) / defender.fastMove.energyGain);
      const turnsToNextCharged = fastToNextCharged * defender.fastMove.turns;
      const cycleDamage = fastToNextCharged * defender.damageOf(defender.fastMove) + defender.damageOf(defender.bestChargedMove);

      const nextAttackerMove = attacker.activeChargedMoves[0]!;
      let attackerTurnsToNextCharged = Math.ceil((nextAttackerMove.energy - attacker.s.energy) / attacker.fastMove.energyGain)
        * attacker.fastMove.turns;

      if (attacker.c.stats.atk > defender.c.stats.atk) {
        attackerTurnsToNextCharged--;
      }

      if (turnsToNextCharged >= attackerTurnsToNextCharged && attacker.s.hp <= cycleDamage) {
        useShield = shieldDecision.value;
      }
    }
  }

  // PvPoke Battle.js:1121-1137 skipped: Aegislash and Cramorant form branches (form changes unsupported).
  // PvPoke Battle.js:1139-1185 skipped: decisionMethod "random" and emulate-only shield overrides.
  return useShield;
}
