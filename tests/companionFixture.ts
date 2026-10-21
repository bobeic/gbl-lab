import { readFileSync } from 'node:fs';
import { buildAppDataFile, FORMATS, loadFormats, rankingsPath, type AppData, type AppDataFile, type FormatId } from '../src/companion';

let file: AppDataFile | undefined;
let formats: Readonly<Record<FormatId, AppData>> | undefined;

/** Every format's vendored rankings, as gen-app-data reads them. */
export function vendoredRankings(): Record<FormatId, unknown> {
  return Object.fromEntries(FORMATS.map((f) => [f.id, JSON.parse(readFileSync(rankingsPath(f), 'utf8')) as unknown])) as Record<FormatId, unknown>;
}

/** The bundled data file built from the vendored data, as the app would fetch it. */
export function testAppDataFile(): AppDataFile {
  file ??= buildAppDataFile(
    JSON.parse(readFileSync('data/gamemaster.json', 'utf8')),
    vendoredRankings(),
    'test',
  );
  return file;
}

/** Every format's loaded app data, shared across tests in one file. */
export function testFormats(): Readonly<Record<FormatId, AppData>> {
  formats ??= loadFormats(testAppDataFile());
  return formats;
}

/** The loaded open Great League app data, shared across tests in one file. */
export function testAppData(): AppData {
  return testFormats().great;
}
