const MAX_OPPONENTS = 3;
const MAX_UNDO = 50;

export interface OpponentSlot {
  readonly speciesId: string;
  readonly fainted: boolean;
}

/** Everything the user has logged about the battle so far. */
export interface BattleSnapshot {
  readonly myShields: number;
  readonly theirShields: number;
  /** Team slot 0..2 on the field, or null between a faint and the next switch-in. */
  readonly onField: number | null;
  readonly fainted: readonly [boolean, boolean, boolean];
  readonly opponents: readonly OpponentSlot[];
  /** The open opponent tab, which is their Pokémon on the field. */
  readonly current: number | null;
  readonly awaitingWhoIsIn: boolean;
  readonly notice: string | null;
}

export interface BattleState {
  readonly now: BattleSnapshot;
  /** Earlier snapshots, oldest first, for undo. */
  readonly past: readonly BattleSnapshot[];
}

export type BattleAction =
  | { type: 'newBattle' }
  | { type: 'addOpponent'; speciesId: string }
  | { type: 'selectOpponent'; index: number }
  | { type: 'iShielded' }
  | { type: 'theyShielded' }
  | { type: 'mineFainted' }
  | { type: 'theirsFainted' }
  | { type: 'switchIn'; slot: number }
  | { type: 'undo' };

/** A fresh battle: shields 2-2, the lead on the field, no opponents seen. */
export function initialBattle(): BattleState {
  return {
    now: { myShields: 2, theirShields: 2, onField: 0, fainted: [false, false, false], opponents: [], current: null, awaitingWhoIsIn: false, notice: null },
    past: [],
  };
}

type Outcome = { next: BattleSnapshot } | { notice: string } | null;

/** Apply one logged action to a snapshot; null means it changes nothing. */
function apply(s: BattleSnapshot, action: Exclude<BattleAction, { type: 'undo' | 'newBattle' }>): Outcome {
  const next = (patch: Partial<BattleSnapshot>): Outcome => ({ next: { ...s, notice: null, ...patch } });
  switch (action.type) {
    case 'addOpponent': {
      const seen = s.opponents.findIndex((o) => o.speciesId === action.speciesId);
      if (seen >= 0) return seen === s.current ? null : next({ current: seen });
      if (s.opponents.length >= MAX_OPPONENTS) return { notice: `Already seen ${MAX_OPPONENTS} opponents` };
      return next({ opponents: [...s.opponents, { speciesId: action.speciesId, fainted: false }], current: s.opponents.length });
    }
    case 'selectOpponent':
      if (action.index === s.current || s.opponents[action.index] === undefined) return null;
      return next({ current: action.index });
    case 'iShielded':
      return s.myShields > 0 ? next({ myShields: s.myShields - 1 }) : null;
    case 'theyShielded':
      return s.theirShields > 0 ? next({ theirShields: s.theirShields - 1 }) : null;
    case 'theirsFainted': {
      const cur = s.current === null ? undefined : s.opponents[s.current];
      if (!cur || cur.fainted) return null;
      return next({ opponents: s.opponents.map((o, i) => (i === s.current ? { ...o, fainted: true } : o)) });
    }
    case 'mineFainted': {
      if (s.onField === null) return null;
      const fainted = s.fainted.map((f, i) => f || i === s.onField) as [boolean, boolean, boolean];
      const left = [0, 1, 2].filter((i) => !fainted[i]);
      if (left.length === 1) return next({ fainted, onField: left[0]!, awaitingWhoIsIn: false });
      return next({ fainted, onField: null, awaitingWhoIsIn: left.length > 1 });
    }
    case 'switchIn': {
      const { slot } = action;
      if (!Number.isInteger(slot) || slot < 0 || slot > 2 || s.fainted[slot] || slot === s.onField) return null;
      return next({ onField: slot, awaitingWhoIsIn: false });
    }
  }
}

/** Apply a logged action; anything that changes the battle can be undone. */
export function battleReducer(state: BattleState, action: BattleAction): BattleState {
  if (action.type === 'newBattle') return initialBattle();
  if (action.type === 'undo') {
    const prev = state.past[state.past.length - 1];
    return prev ? { now: prev, past: state.past.slice(0, -1) } : state;
  }
  const outcome = apply(state.now, action);
  if (outcome === null) return state;
  // A refusal only shows a notice; it is not a battle change, so it adds no undo entry.
  if ('notice' in outcome) return { ...state, now: { ...state.now, notice: outcome.notice } };
  return { now: outcome.next, past: [...state.past, state.now].slice(-MAX_UNDO) };
}
