// Map every gamemaster species to its Pokémon GO icon in PokeMiners/pogo_assets and write data/pogo-icons.json.
// Run by hand (npm run gen-icons) after a gamemaster update; the app reads the committed map.
import { readFileSync, writeFileSync } from 'node:fs';

export const ICON_REPO = 'PokeMiners/pogo_assets';
export const ICON_DIR = 'Images/Pokemon - 256x256/Addressable Assets';
const OUT = 'data/pogo-icons.json';

// Names whose parenthesised form doesn't match the asset's form code.
const OVERRIDES: Record<string, string> = {
  mimikyu: 'pm778.fDISGUISED.icon.png',
  zygarde: 'pm718.fFIFTY_PERCENT.icon.png',
  zygarde_10: 'pm718.fTEN_PERCENT.icon.png',
  cherrim_sunny: 'pm421.fSUNNY.icon.png',
};
const ALIAS: Record<string, string> = { ALOLAN: 'ALOLA', PALDEAN: 'PALDEA' };
const norm = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** The icon file for one species, or null when the asset set has none. */
export function iconFor(speciesId: string, dex: number, speciesName: string, files: ReadonlySet<string>): string | null {
  if (OVERRIDES[speciesId] && files.has(OVERRIDES[speciesId])) return OVERRIDES[speciesId];
  const words = [...speciesName.matchAll(/\(([^)]*)\)/g)]
    .flatMap((m) => m[1]!.split(' '))
    .filter((w) => w !== 'Shadow')
    .map((w) => ALIAS[w.toUpperCase()] ?? w.toUpperCase());
  const forms = [...files].filter((f) => f.startsWith(`pm${dex}.f`)).sort();
  const code = (f: string): string => norm(f.split('.')[1]!.slice(1));
  if (words.length > 0) {
    const key = norm(words.join(''));
    const hit = forms.find((f) => code(f) === key) ?? forms.find((f) => code(f).endsWith(key)) ?? forms.find((f) => code(f).includes(key));
    if (hit) return hit;
  }
  if (files.has(`pm${dex}.icon.png`)) return `pm${dex}.icon.png`;
  // Species that only ship form icons (Shellos, Genesect…): prefer the NORMAL form, else the first.
  return forms.find((f) => f.includes('.fNORMAL.')) ?? forms[0] ?? null;
}

async function main(): Promise<void> {
  // Walk down to the icon folder one level at a time; the full recursive listing is too big to fetch reliably.
  let sha = 'master';
  let entries: { path: string; sha: string }[] = [];
  for (const part of ['', ...ICON_DIR.split('/')]) {
    if (part !== '') {
      const dir = entries.find((e) => e.path === part);
      if (!dir) throw new Error(`${ICON_REPO} has no folder ${part}`);
      sha = dir.sha;
    }
    const res = await fetch(`https://api.github.com/repos/${ICON_REPO}/git/trees/${sha}`);
    if (!res.ok) throw new Error(`GitHub tree fetch failed: ${res.status}`);
    const tree = (await res.json()) as { truncated: boolean; tree: { path: string; sha: string }[] };
    if (tree.truncated) throw new Error('GitHub tree listing was truncated');
    entries = tree.tree;
  }
  // Plain icons only: no shiny (.s), gender (.g2) or costume (.c) variants.
  const files = new Set(entries.map((e) => e.path).filter((f) => /^pm\d+(\.f[A-Z0-9_]+)?\.icon\.png$/.test(f)));
  const gm = JSON.parse(readFileSync('data/gamemaster.json', 'utf8')) as { pokemon: { speciesId: string; speciesName: string; dex: number }[] };
  const map: Record<string, string> = {};
  for (const p of gm.pokemon) {
    const file = iconFor(p.speciesId, p.dex, p.speciesName, files);
    if (file) map[p.speciesId] = file;
  }
  writeFileSync(OUT, `${JSON.stringify(map, null, 1)}\n`);
  console.log(`Wrote ${OUT}: ${Object.keys(map).length} of ${gm.pokemon.length} species have an icon`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
