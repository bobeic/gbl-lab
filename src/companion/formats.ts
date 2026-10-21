/** The formats the companion supports, in picker order. Adding one: an entry here, then `npm run update-data`. */
export type FormatId = 'great' | 'fantasy';

export interface Format {
  readonly id: FormatId;
  readonly title: string;
  /** PvPoke's cup id: its rankings are src/data/rankings/<cup>/overall/rankings-1500.json. */
  readonly cup: string;
}

export const FORMATS: readonly Format[] = [
  { id: 'great', title: 'Great League', cup: 'all' },
  { id: 'fantasy', title: 'Fantasy Cup', cup: 'fantasy' },
];

/** The vendored rankings file for a format (open Great League keeps its original name). */
export function rankingsPath(format: Format): string {
  return format.cup === 'all' ? 'data/rankings-1500.json' : `data/rankings-${format.cup}-1500.json`;
}
