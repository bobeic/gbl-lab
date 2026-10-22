import { parseRoster, type RosterEntry } from '../matrix/teamMatrix';
import { initialBattle, type BattleSnapshot, type BattleState } from './battle';
import type { MoveOverrides } from './appData';
import { FORMATS, type FormatId } from './formats';

/** The subset of the Web Storage API the companion uses, so tests can pass an in-memory store. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** What each format keeps separately: its team, battle, Builder priorities and the opponent movesets the user has seen. */
export interface FormatState {
  /** Indices into the shared roster, lead first; null until the user picks a team. */
  readonly team: readonly [number, number, number] | null;
  readonly battle: BattleState;
  /** Meta species ids the Builder weights extra, e.g. ones the user meets a lot. */
  readonly priorities: readonly string[];
  /** Opponent movesets used instead of the rankings' ones. */
  readonly moves: MoveOverrides;
}

export interface SavedApp {
  readonly version: 2;
  /** The user's collection, shared by every format. */
  readonly roster: readonly RosterEntry[];
  readonly format: FormatId;
  readonly byFormat: Readonly<Record<FormatId, FormatState>>;
}

export const STORAGE_KEY = 'gbl-companion';

export function defaultFormatState(): FormatState {
  return { team: null, battle: initialBattle(), priorities: [], moves: {} };
}

const allFormats = (state: (id: FormatId) => FormatState): Record<FormatId, FormatState> =>
  Object.fromEntries(FORMATS.map((f) => [f.id, state(f.id)])) as Record<FormatId, FormatState>;

/** An empty roster, Great League, and no team and a fresh battle in every format. */
export function defaultSavedApp(): SavedApp {
  return { version: 2, roster: [], format: 'great', byFormat: allFormats(defaultFormatState) };
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

const isMoveset = (v: unknown): v is readonly [string, ...string[]] =>
  Array.isArray(v) && v.length >= 2 && v.length <= 3 && v.every((m) => typeof m === 'string' && m !== '');

function isBattle(v: unknown): v is BattleState {
  return isRecord(v) && isSnapshot(v.now) && Array.isArray(v.past) && v.past.every(isSnapshot);
}

/** One format's saved state; anything malformed in it falls back on its own, never costing the roster. */
function formatState(v: unknown, rosterSize: number): FormatState {
  if (!isRecord(v)) return defaultFormatState();
  return {
    team: isTeam(v.team, rosterSize) ? v.team : null,
    battle: isBattle(v.battle) ? v.battle : initialBattle(),
    // Missing on saves from before priorities existed.
    priorities: Array.isArray(v.priorities) && v.priorities.every((p) => typeof p === 'string') ? v.priorities : [],
    // Missing on saves from before move overrides existed; a malformed moveset is dropped on its own.
    moves: isRecord(v.moves) ? Object.fromEntries(Object.entries(v.moves).filter(([, m]) => isMoveset(m))) as MoveOverrides : {},
  };
}

/** Restore the saved app, falling back to defaults on anything missing, corrupt or from another version. */
export function loadSaved(store: KeyValueStore | null): SavedApp {
  try {
    const text = store?.getItem(STORAGE_KEY);
    if (!text) return defaultSavedApp();
    const v: unknown = JSON.parse(text);
    if (!isRecord(v)) return defaultSavedApp();
    const roster = parseRoster(v.roster);
    // Version 1 had one team, battle and priorities: they become Great League's.
    if (v.version === 1) {
      return { version: 2, roster, format: 'great', byFormat: allFormats((id) => (id === 'great' ? formatState(v, roster.length) : defaultFormatState())) };
    }
    if (v.version !== 2) return defaultSavedApp();
    const byFormat = isRecord(v.byFormat) ? v.byFormat : {};
    const format = FORMATS.find((f) => f.id === v.format)?.id ?? 'great';
    return { version: 2, roster, format, byFormat: allFormats((id) => formatState(byFormat[id], roster.length)) };
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
