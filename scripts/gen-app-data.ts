import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAppDataFile } from '../src/companion/appData';
import { readUpstream } from './gen-matrix';

export const APP_DATA_PATH = 'app/public/app-data.json';

function main(): void {
  const gamemaster: unknown = JSON.parse(readFileSync('data/gamemaster.json', 'utf8'));
  const rankings: unknown = JSON.parse(readFileSync('data/rankings-1500.json', 'utf8'));
  const text = JSON.stringify(buildAppDataFile(gamemaster, rankings, readUpstream()));
  mkdirSync(dirname(APP_DATA_PATH), { recursive: true });
  writeFileSync(APP_DATA_PATH, text);
  console.log(`Wrote ${APP_DATA_PATH} (${(text.length / 1024).toFixed(0)} KiB)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
