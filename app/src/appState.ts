import { battleReducer, type BattleAction, type FormatId, type FormatState, type MoveOverrides, type SavedApp } from '../../src/companion';
import type { RosterEntry } from '../../src/matrix/teamMatrix';

export type AppAction =
  | { type: 'setTeam'; roster: readonly RosterEntry[]; team: FormatState['team'] }
  | { type: 'battle'; action: BattleAction }
  | { type: 'setPriorities'; priorities: readonly string[] }
  /** null goes back to the rankings' moveset. */
  | { type: 'setMoves'; speciesId: string; moveset: MoveOverrides[string] | null }
  | { type: 'setFormat'; format: FormatId };

/**
 * Another format's team after the shared roster changed from `before` to `after`.
 * The Team screen only appends entries or deletes one; a deleted member drops the team, later indices shift down.
 */
function remapTeam(team: FormatState['team'], before: readonly RosterEntry[], after: readonly RosterEntry[]): FormatState['team'] {
  if (team === null || after.length >= before.length) return team;
  const removed = before.findIndex((e, i) => after[i] !== e);
  if (team.includes(removed)) return null;
  const [a, b, c] = team.map((i) => (i > removed ? i - 1 : i));
  return [a!, b!, c!];
}

/** Everything the user changes goes through here, so one effect can save it. */
export function appReducer(state: SavedApp, action: AppAction): SavedApp {
  const current = state.byFormat[state.format];
  const withCurrent = (next: FormatState): SavedApp => ({ ...state, byFormat: { ...state.byFormat, [state.format]: next } });
  switch (action.type) {
    case 'setTeam': {
      const byFormat = Object.fromEntries(Object.entries(state.byFormat).map(([id, f]) => [
        id, id === state.format ? { ...f, team: action.team } : { ...f, team: remapTeam(f.team, state.roster, action.roster) },
      ])) as SavedApp['byFormat'];
      return { ...state, roster: action.roster, byFormat };
    }
    case 'battle': {
      const battle = battleReducer(current.battle, action.action);
      return battle === current.battle ? state : withCurrent({ ...current, battle });
    }
    case 'setPriorities':
      return withCurrent({ ...current, priorities: action.priorities });
    case 'setMoves': {
      const { [action.speciesId]: _, ...rest } = current.moves;
      return withCurrent({ ...current, moves: action.moveset ? { ...rest, [action.speciesId]: action.moveset } : rest });
    }
    case 'setFormat':
      return { ...state, format: action.format };
  }
}
