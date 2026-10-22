import { loadGameData } from '../data/loader';
import type { GameData } from '../data/types';
import { GameDataError } from '../errors';
import { FORMATS, type Format, type FormatId } from './formats';

/** A species in a format's PvPoke rankings: the only ones the companion can search in that format. */
export interface RankedSpecies {
  readonly speciesId: string;
  readonly name: string;
  /** 0-based position in the rankings. */
  readonly rank: number;
  /** [fast, charged1, charged2?] */
  readonly moveset: readonly [string, ...string[]];
}

/** The trimmed data file the web app fetches. */
export interface AppDataFile {
  readonly upstream: string;
  readonly gamemaster: unknown;
  /** One rankings list per format, in FORMATS order. */
  readonly formats: readonly { id: FormatId; rankings: readonly { speciesId: string; speciesName: string; moveset: string[] }[] }[];
}

/** One format's view of the data: the shared game data plus that format's rankings. */
export interface AppData {
  readonly format: Format;
  readonly gd: GameData;
  readonly ranked: readonly RankedSpecies[];
  readonly byId: ReadonlyMap<string, RankedSpecies>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Trim the raw gamemaster and rankings down to what the companion needs. */
export function buildAppDataFile(gamemasterRaw: unknown, rankingsByFormat: Readonly<Record<FormatId, unknown>>, upstream: string): AppDataFile {
  if (!isRecord(gamemasterRaw)) throw new GameDataError('gamemaster: expected an object');
  const { settings, pokemon, moves } = gamemasterRaw;
  const formats = FORMATS.map(({ id }) => {
    const rankingsRaw = rankingsByFormat[id];
    if (!Array.isArray(rankingsRaw)) throw new GameDataError(`${id} rankings: expected an array`);
    const rankings = rankingsRaw.map((row: unknown, i) => {
      if (!isRecord(row)) throw new GameDataError(`${id} rankings[${i}]: expected an object`);
      return { speciesId: row.speciesId as string, speciesName: row.speciesName as string, moveset: row.moveset as string[] };
    });
    return { id, rankings };
  });
  return { upstream, gamemaster: { settings, pokemon, moves }, formats };
}

/** Same rule as the matrix's ranking movesets: a fast move and at least one charged move, all non-empty strings. */
function validMoveset(ms: unknown): ms is [string, ...string[]] {
  return Array.isArray(ms) && ms.length >= 2 && ms.every((m) => typeof m === 'string' && m !== '');
}

/** Validate a fetched data file and index each format's ranked species; the game data is parsed once and shared. */
export function loadFormats(file: unknown): Readonly<Record<FormatId, AppData>> {
  if (!isRecord(file) || !Array.isArray(file.formats)) throw new GameDataError('app data: expected an object with a formats array');
  const gd = loadGameData(file.gamemaster);
  const rows = file.formats as unknown[];
  const entries = FORMATS.map((format): [FormatId, AppData] => {
    const f = rows.find((x) => isRecord(x) && x.id === format.id);
    if (!isRecord(f) || !Array.isArray(f.rankings)) throw new GameDataError(`app data: no rankings for ${format.title}`);
    const ranked = f.rankings.map((row: unknown, rank): RankedSpecies => {
      if (!isRecord(row) || typeof row.speciesId !== 'string' || typeof row.speciesName !== 'string') {
        throw new GameDataError(`app data ${format.id} rankings[${rank}]: expected speciesId and speciesName strings`);
      }
      if (!validMoveset(row.moveset)) throw new GameDataError(`${row.speciesId}: malformed ranking moveset ${JSON.stringify(row.moveset)}`);
      return { speciesId: row.speciesId, name: row.speciesName, rank, moveset: row.moveset };
    });
    return [format.id, { format, gd, ranked, byId: new Map(ranked.map((r) => [r.speciesId, r])) }];
  });
  return Object.fromEntries(entries) as Record<FormatId, AppData>;
}

/** Opponent movesets the user has seen, by species id: [fast, charged1, charged2?]. */
export type MoveOverrides = Readonly<Record<string, readonly [string, ...string[]]>>;

/** The app with these movesets in place of the rankings' ones. */
export function withMoves(app: AppData, moves: MoveOverrides): AppData {
  const ranked = app.ranked.map((r) => (moves[r.speciesId] ? { ...r, moveset: moves[r.speciesId]! } : r));
  return { ...app, ranked, byId: new Map(ranked.map((r) => [r.speciesId, r])) };
}

/** The open Great League view of a data file. */
export function loadAppData(file: unknown): AppData {
  return loadFormats(file).great;
}
