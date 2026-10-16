import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadDefaultGameData } from '../src/data/node';
import { buildMatrixFile, mirrorMismatches, type MirrorMismatch } from '../src/matrix/batch';
import type { MatrixFile } from '../src/matrix/matrixData';
import { buildMeta, type RankingRow } from '../src/matrix/meta';

export const MATRIX_PATH = 'data/matrix-1500.json';
export const DEFAULT_META_SIZE = 150;
const REPORT_PATH = 'reports/matrix-report.md';

/** Read the vendored PvPoke commit from data/UPSTREAM, failing if the file is missing. */
export function readUpstream(): string {
  if (!existsSync('data/UPSTREAM')) throw new Error('data/UPSTREAM is missing; run npm run update-data -- <commit>');
  return readFileSync('data/UPSTREAM', 'utf8').trim();
}

/** Render the run report: meta size, exclusions, timing and mirror-check results. */
export function formatReport(file: MatrixFile, mismatches: readonly MirrorMismatch[], elapsedMs: number, date: string): string {
  const lines = [
    '# Matchup matrix report',
    '',
    `Generated ${date} by \`npm run gen-matrix\` from PvPoke commit \`${file.upstream}\`.`,
    '',
    `- Meta size: ${file.meta.length}`,
    `- Simulations: ${file.meta.length ** 2 * 9}`,
    `- Elapsed: ${(elapsedMs / 1000).toFixed(1)} s`,
    `- Mirror mismatches (off by more than 1): ${mismatches.length}`,
    '',
    '## Excluded (unsupported) before the meta was full',
    '',
    ...(file.excluded.length ? file.excluded.map((e) => `- ${e.speciesId}: ${e.reason}`) : ['None.']),
    '',
    '## Mirror mismatches (first 20)',
    '',
    'a\'s rating vs b at shields sa-sb, and b\'s rating vs a at sb-sa. These should add up to 1000 (999 after flooring).',
    '',
    '| a | b | shields (a-b) | a rating | b rating |',
    '|---|---|---|---|---|',
    ...mismatches.slice(0, 20).map((m) => `| ${m.a} | ${m.b} | ${m.shields[0]}-${m.shields[1]} | ${m.ab} | ${m.ba} |`),
    '',
  ];
  return lines.join('\n');
}

function parseSize(): number {
  const i = process.argv.indexOf('--size');
  if (i === -1) return DEFAULT_META_SIZE;
  const value = process.argv[i + 1] ?? '';
  if (!/^\d+$/.test(value) || Number(value) < 1) throw new Error(`--size must be a positive integer (got ${value || 'nothing'})`);
  return Number(value);
}

function main(): void {
  const size = parseSize();
  const upstream = readUpstream();
  const gd = loadDefaultGameData();
  const rankings: RankingRow[] = JSON.parse(readFileSync('data/rankings-1500.json', 'utf8'));
  const meta = buildMeta(gd, rankings, size);
  for (const e of meta.excluded) console.error(`excluded ${e.speciesId}: ${e.reason}`);

  const start = performance.now();
  const file = buildMatrixFile(gd, meta, upstream, (done, total) => {
    if (done % 10 === 0 || done === total) console.error(`${done}/${total} rows`);
  });
  const elapsed = performance.now() - start;
  const mismatches = mirrorMismatches(file);

  // Only the default size is the committed artifact; quick runs go to the gitignored cache.
  const out = size === DEFAULT_META_SIZE ? MATRIX_PATH : `.cache/matrix-1500-${size}.json`;
  mkdirSync('.cache', { recursive: true });
  writeFileSync(out, `${JSON.stringify(file)}\n`);
  if (size === DEFAULT_META_SIZE) {
    mkdirSync('reports', { recursive: true });
    writeFileSync(REPORT_PATH, formatReport(file, mismatches, elapsed, new Date().toISOString().slice(0, 10)));
  }
  console.log(`Wrote ${out}: ${size} x ${size} x 9 in ${(elapsed / 1000).toFixed(1)} s; ${mismatches.length} mirror mismatches`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
