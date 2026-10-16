import type { KeyValueStore } from '../../src/companion';

/** The browser's localStorage, or null where reading it throws (some private modes, blocked site data). */
export function browserStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
