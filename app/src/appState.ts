import { battleReducer, type BattleAction, type SavedApp } from '../../src/companion';
import type { RosterEntry } from '../../src/matrix/teamMatrix';

export type AppAction =
  | { type: 'setTeam'; roster: readonly RosterEntry[]; team: SavedApp['team'] }
  | { type: 'battle'; action: BattleAction }
  | { type: 'setPriorities'; priorities: readonly string[] };

/** Everything the user changes goes through here, so one effect can save it. */
export function appReducer(state: SavedApp, action: AppAction): SavedApp {
  switch (action.type) {
    case 'setTeam':
      return { ...state, roster: action.roster, team: action.team };
    case 'setPriorities':
      return { ...state, priorities: action.priorities };
    case 'battle': {
      const battle = battleReducer(state.battle, action.action);
      return battle === state.battle ? state : { ...state, battle };
    }
  }
}
