import { readFileSync } from 'node:fs';
import { buildAppDataFile, loadAppData, type AppData, type AppDataFile } from '../src/companion';

let file: AppDataFile | undefined;
let app: AppData | undefined;

/** The bundled data file built from the vendored data, as the app would fetch it. */
export function testAppDataFile(): AppDataFile {
  file ??= buildAppDataFile(
    JSON.parse(readFileSync('data/gamemaster.json', 'utf8')),
    JSON.parse(readFileSync('data/rankings-1500.json', 'utf8')),
    'test',
  );
  return file;
}

/** The loaded app data, shared across tests in one file. */
export function testAppData(): AppData {
  app ??= loadAppData(testAppDataFile());
  return app;
}
