import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadGameData } from './loader';
import type { GameData } from './types';

let cached: GameData | undefined;

/** Load the vendored gamemaster from data/ (Node only; the web app will fetch it instead). */
export function loadDefaultGameData(): GameData {
  if (!cached) {
    const path = fileURLToPath(new URL('../../data/gamemaster.json', import.meta.url));
    cached = loadGameData(JSON.parse(readFileSync(path, 'utf8')));
  }
  return cached;
}
