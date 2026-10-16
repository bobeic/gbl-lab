import type { RankedSpecies } from './appData';

/** Lowercase, strip diacritics, and turn every run of punctuation or spaces into one space. */
export function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const nameWords = new WeakMap<RankedSpecies, readonly string[]>();

function wordsOf(r: RankedSpecies): readonly string[] {
  let words = nameWords.get(r);
  if (!words) {
    words = normalizeName(r.name).split(' ');
    nameWords.set(r, words);
  }
  return words;
}

/** Ranked species whose name has a word starting with each query word, in rank order. */
export function searchSpecies(ranked: readonly RankedSpecies[], query: string, limit = 8): RankedSpecies[] {
  const q = normalizeName(query);
  if (q === '') return [];
  const terms = q.split(' ');
  const out: RankedSpecies[] = [];
  for (const r of ranked) {
    if (out.length >= limit) break;
    const words = wordsOf(r);
    if (terms.every((t) => words.some((w) => w.startsWith(t)))) out.push(r);
  }
  return out;
}
