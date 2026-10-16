import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadDefaultGameData } from '../src/data/node';
import type { GameData } from '../src/data/types';
import type { MatrixRow } from '../src/matrix/cell';
import { metaRow, parseMatrixFile, type MatrixFile } from '../src/matrix/matrixData';
import { summarize } from '../src/matrix/summary';
import { parseRoster, teamMatrix } from '../src/matrix/teamMatrix';
import { MATRIX_PATH, readUpstream } from './gen-matrix';
import { arg, parseShields } from './sim';

const LIST_LENGTH = 10;

/** Render one row: summary per scenario, then its best and worst opponents at the given shields. */
export function formatRow(gd: GameData, file: MatrixFile, row: MatrixRow, shields: readonly [number, number]): string {
  const name = (id: string): string => gd.species.get(id)?.name ?? id;
  const s = summarize(row);
  const [sa, sb] = shields;
  const scored = row.cells
    .map((cell, j) => ({ opponent: name(file.meta[j]!.speciesId), rating: cell[sa]![sb]! }))
    .sort((x, y) => y.rating - x.rating);
  const list = (items: typeof scored): string[] => items.map((x) => `  ${String(x.rating).padStart(4)}  ${x.opponent}`);
  return [
    gd.species.has(row.id) ? name(row.id) : row.id,
    `Average (1-1): ${s.average[1][1]}`,
    `Wins/losses: 0-0 ${s.wins[0][0]}/${s.losses[0][0]} · 1-1 ${s.wins[1][1]}/${s.losses[1][1]} · 2-2 ${s.wins[2][2]}/${s.losses[2][2]}`,
    `Best at ${sa}-${sb}:`,
    ...list(scored.slice(0, LIST_LENGTH)),
    `Worst at ${sa}-${sb}:`,
    ...list(scored.slice(-LIST_LENGTH).reverse()),
  ].join('\n');
}

function loadMatrix(): MatrixFile {
  const file = parseMatrixFile(JSON.parse(readFileSync(MATRIX_PATH, 'utf8')));
  const upstream = readUpstream();
  if (file.upstream !== upstream) {
    throw new Error(`${MATRIX_PATH} is stale (built from ${file.upstream}, data is ${upstream}); run npm run gen-matrix`);
  }
  return file;
}

function readRoster(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`Cannot read roster file ${path}: ${(e as Error).message}`);
  }
}

function main(): void {
  const usage = 'Usage: npm run matrix -- <speciesId> [--shields 1 1]  |  npm run matrix -- --roster <file.json> [--shields 1 1]';
  const shields = parseShields(arg('--shields', 2));
  const gd = loadDefaultGameData();
  const rosterArgs = arg('--roster', 1);

  if (rosterArgs !== undefined) {
    const path = rosterArgs[0];
    if (path === undefined || path.startsWith('--')) throw new Error('--roster needs a path to a roster JSON file');
    const roster = parseRoster(readRoster(path));
    const file = loadMatrix();
    const rows = teamMatrix(gd, roster, file.meta);
    console.log(rows.map((row) => formatRow(gd, file, row, shields)).join('\n\n'));
    return;
  }

  const speciesId = process.argv[2];
  if (speciesId === undefined || speciesId.startsWith('--')) throw new Error(usage);
  if (!gd.species.has(speciesId)) throw new Error(`Unknown species ${speciesId}`);
  const file = loadMatrix();
  console.log(formatRow(gd, file, metaRow(file, speciesId), shields));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
