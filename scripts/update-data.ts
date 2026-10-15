import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const UPSTREAM_URL = 'https://github.com/pvpoke/pvpoke.git';
const CHECKOUT_DIR = join('.cache', 'pvpoke');

/** Fetch PvPoke at a pinned commit into .cache/pvpoke and vendor its data files into data/. */
function updateData(commit: string): void {
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`Expected a full 40-char commit hash, got "${commit}"`);
  }
  if (existsSync(CHECKOUT_DIR)) rmSync(CHECKOUT_DIR, { recursive: true, force: true });
  mkdirSync(CHECKOUT_DIR, { recursive: true });
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: CHECKOUT_DIR, stdio: 'inherit' });
  };
  git('init', '-q');
  git('remote', 'add', 'origin', UPSTREAM_URL);
  git('fetch', '-q', '--depth', '1', 'origin', commit);
  git('checkout', '-q', 'FETCH_HEAD');

  const src = join(CHECKOUT_DIR, 'src', 'data');
  copyFileSync(join(src, 'gamemaster.json'), join('data', 'gamemaster.json'));
  copyFileSync(join(src, 'rankings', 'all', 'overall', 'rankings-1500.json'), join('data', 'rankings-1500.json'));
  writeFileSync(join('data', 'UPSTREAM'), `${commit}\n`);
  console.log(`Vendored PvPoke data at ${commit}`);
}

const commit = process.argv[2];
if (!commit) {
  console.error('Usage: npm run update-data -- <commit-hash>');
  process.exit(1);
}
updateData(commit);
