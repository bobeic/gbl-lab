import { loadGameData } from '../data/loader';
import type { GameData } from '../data/types';
import { GameDataError } from '../errors';

/** A species in PvPoke's Great League rankings: the only ones the companion can search. */
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
  readonly rankings: readonly { speciesId: string; speciesName: string; moveset: string[] }[];
}

export interface AppData {
  readonly gd: GameData;
  readonly ranked: readonly RankedSpecies[];
  readonly byId: ReadonlyMap<string, RankedSpecies>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Trim the raw gamemaster and rankings down to what the companion needs. */
export function buildAppDataFile(gamemasterRaw: unknown, rankingsRaw: unknown, upstream: string): AppDataFile {
  if (!isRecord(gamemasterRaw)) throw new GameDataError('gamemaster: expected an object');
  if (!Array.isArray(rankingsRaw)) throw new GameDataError('rankings: expected an array');
  const { settings, pokemon, moves } = gamemasterRaw;
  const rankings = rankingsRaw.map((row: unknown, i) => {
    if (!isRecord(row)) throw new GameDataError(`rankings[${i}]: expected an object`);
    return { speciesId: row.speciesId as string, speciesName: row.speciesName as string, moveset: row.moveset as string[] };
  });
  return { upstream, gamemaster: { settings, pokemon, moves }, rankings };
}

/** Same rule as the matrix's ranking movesets: a fast move and at least one charged move, all non-empty strings. */
function validMoveset(ms: unknown): ms is [string, ...string[]] {
  return Array.isArray(ms) && ms.length >= 2 && ms.every((m) => typeof m === 'string' && m !== '');
}

/** Validate a fetched data file and index its ranked species. */
export function loadAppData(file: unknown): AppData {
  if (!isRecord(file) || !Array.isArray(file.rankings)) throw new GameDataError('app data: expected an object with a rankings array');
  const gd = loadGameData(file.gamemaster);
  const ranked = file.rankings.map((row: unknown, rank): RankedSpecies => {
    if (!isRecord(row) || typeof row.speciesId !== 'string' || typeof row.speciesName !== 'string') {
      throw new GameDataError(`app data rankings[${rank}]: expected speciesId and speciesName strings`);
    }
    if (!validMoveset(row.moveset)) throw new GameDataError(`${row.speciesId}: malformed ranking moveset ${JSON.stringify(row.moveset)}`);
    return { speciesId: row.speciesId, name: row.speciesName, rank, moveset: row.moveset };
  });
  return { gd, ranked, byId: new Map(ranked.map((r) => [r.speciesId, r])) };
}
