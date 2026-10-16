import { parseRoster, type RosterEntry } from '../matrix/teamMatrix';
import { initialBattle, type BattleSnapshot, type BattleState } from './battle';

/** The subset of the Web Storage API the companion uses, so tests can pass an in-memory store. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SavedApp {
  readonly version: 1;
  readonly roster: readonly RosterEntry[];
  /** Indices into roster, lead first; null until the user picks a team. */
  readonly team: readonly [number, number, number] | null;
  readonly battle: BattleState;
}

export const STORAGE_KEY = 'gbl-companion';

/** An empty roster, no team and a fresh battle. */
export function defaultSavedApp(): SavedApp {
  return { version: 1, roster: [], team: null, battle: initialBattle() };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const isSlot = (v: unknown): boolean => v === null || isInt(v, 0, 2);

function isTeam(v: unknown, rosterSize: number): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((i) => isInt(i, 0, rosterSize - 1)) && new Set(v).size === 3;
}

function isSnapshot(v: unknown): v is BattleSnapshot {
  if (!isRecord(v)) return false;
  const { opponents, fainted, current } = v;
  return isInt(v.myShields, 0, 2) && isInt(v.theirShields, 0, 2) && isSlot(v.onField)
    && Array.isArray(fainted) && fainted.length === 3 && fainted.every((f) => typeof f === 'boolean')
    && Array.isArray(opponents) && opponents.length <= 3
    && opponents.every((o) => isRecord(o) && typeof o.speciesId === 'string' && typeof o.fainted === 'boolean')
    && (current === null || isInt(current, 0, opponents.length - 1))
    && typeof v.awaitingWhoIsIn === 'boolean' && (v.notice === null || typeof v.notice === 'string');
}

function isBattle(v: unknown): v is BattleState {
  return isRecord(v) && isSnapshot(v.now) && Array.isArray(v.past) && v.past.every(isSnapshot);
}

/** Restore the saved app, falling back to defaults on anything missing, corrupt or from another version. */
export function loadSaved(store: KeyValueStore | null): SavedApp {
  try {
    const text = store?.getItem(STORAGE_KEY);
    if (!text) return defaultSavedApp();
    const v: unknown = JSON.parse(text);
    if (!isRecord(v) || v.version !== 1) return defaultSavedApp();
    const roster = parseRoster(v.roster);
    if (v.team !== null && !isTeam(v.team, roster.length)) return defaultSavedApp();
    // A bad battle only costs the battle in progress, not the roster the user typed in.
    const battle = isBattle(v.battle) ? v.battle : initialBattle();
    return { version: 1, roster, team: v.team, battle };
  } catch {
    return defaultSavedApp();
  }
}

/** Save the app; returns false (never throws) when storage is unavailable or full. */
export function save(store: KeyValueStore | null, app: SavedApp): boolean {
  if (!store) return false;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(app));
    return true;
  } catch {
    return false;
  }
}
