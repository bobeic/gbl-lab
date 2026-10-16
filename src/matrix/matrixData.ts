import { GameDataError } from '../errors';
import type { Cell, MatrixRow } from './cell';
import type { ExcludedEntry, MetaEntry } from './meta';

/** The committed meta × meta matrix (data/matrix-1500.json). */
export interface MatrixFile {
  /** PvPoke commit of the game data and rankings it was built from (data/UPSTREAM). */
  readonly upstream: string;
  readonly generatedWith: { readonly metaSize: number; readonly policy: 'pvpoke'; readonly startEnergy: readonly [number, number] };
  readonly meta: readonly MetaEntry[];
  readonly excluded: readonly ExcludedEntry[];
  /** ratings[a][b][aShields][bShields]: meta a's rating against meta b. */
  readonly ratings: readonly (readonly Cell[])[];
}

function fail(path: string, problem: string): never {
  throw new GameDataError(`Matrix file${path ? ` ${path}` : ''}: ${problem}`);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function checkMetaEntry(v: unknown, path: string): void {
  if (!isRecord(v)) fail(path, 'expected an object');
  const { speciesId, moveset, ivs, level, cp } = v;
  if (typeof speciesId !== 'string' || speciesId === '') fail(`${path}.speciesId`, 'expected a non-empty string');
  if (!Array.isArray(moveset) || moveset.length < 2 || moveset.some((m) => typeof m !== 'string')) fail(`${path}.moveset`, 'expected [fast, charged, ...] move ids');
  if (!isRecord(ivs) || !['atk', 'def', 'hp'].every((k) => Number.isInteger(ivs[k]))) fail(`${path}.ivs`, 'expected integer atk, def and hp');
  if (typeof level !== 'number') fail(`${path}.level`, 'expected a number');
  if (!Number.isInteger(cp)) fail(`${path}.cp`, 'expected an integer');
}

function checkCell(v: unknown, path: string): void {
  if (!Array.isArray(v) || v.length !== 3 || v.some((row) => !Array.isArray(row) || row.length !== 3)) fail(path, 'expected a 3x3 array');
  (v as unknown[][]).forEach((row, sa) => row.forEach((r, sb) => {
    if (!Number.isInteger(r) || (r as number) < 0 || (r as number) > 1000) fail(`${path}[${sa}][${sb}]`, `expected an integer 0-1000, got ${JSON.stringify(r)}`);
  }));
}

/** Validate parsed JSON as a MatrixFile, naming the first offending path. */
export function parseMatrixFile(json: unknown): MatrixFile {
  if (!isRecord(json)) fail('', 'expected an object');
  const { upstream, generatedWith, meta, excluded, ratings } = json;
  if (typeof upstream !== 'string' || !/^[0-9a-f]{40}$/.test(upstream)) fail('upstream', 'expected a 40-character commit SHA');
  if (!Array.isArray(meta)) fail('meta', 'expected an array');
  meta.forEach((m, i) => checkMetaEntry(m, `meta[${i}]`));
  if (!isRecord(generatedWith) || generatedWith.metaSize !== meta.length) fail('generatedWith.metaSize', `expected ${meta.length} (the meta length)`);
  if (generatedWith.policy !== 'pvpoke') fail('generatedWith.policy', 'expected "pvpoke"');
  if (!Array.isArray(excluded) || excluded.some((e) => !isRecord(e) || typeof e.speciesId !== 'string' || typeof e.reason !== 'string')) {
    fail('excluded', 'expected an array of { speciesId, reason }');
  }
  if (!Array.isArray(ratings) || ratings.length !== meta.length) fail('ratings', `expected ${meta.length} rows`);
  ratings.forEach((row, a) => {
    if (!Array.isArray(row) || row.length !== meta.length) fail(`ratings[${a}]`, `expected ${meta.length} cells`);
    row.forEach((cell, b) => checkCell(cell, `ratings[${a}][${b}]`));
  });
  return json as unknown as MatrixFile;
}

/** Return a meta Pokémon's row (its ratings against every meta entry) from the matrix file. */
export function metaRow(file: MatrixFile, speciesId: string): MatrixRow {
  const i = file.meta.findIndex((m) => m.speciesId === speciesId);
  if (i === -1) throw new GameDataError(`${speciesId} is not in the matrix meta`);
  return { id: speciesId, cells: file.ratings[i]! };
}
