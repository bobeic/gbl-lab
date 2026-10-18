import type { GameData } from '../data/types';
import type { MetaEntry } from '../matrix/meta';
import type { RosterEntry } from '../matrix/teamMatrix';
import { simulateRoster, type SimResult } from './builderSim';
import type { Diag } from './teamBuilder';

/** Messages between the app and the Builder's simulation worker. */
export interface BuilderRequest {
  readonly id: number;
  readonly roster: readonly RosterEntry[];
}

export type BuilderReply =
  | { readonly id: number; readonly type: 'progress'; readonly done: number; readonly total: number }
  | { readonly id: number; readonly type: 'done'; readonly result: SimResult; readonly metaIds: readonly string[] }
  | { readonly id: number; readonly type: 'error'; readonly message: string };

/** Simulate one request's roster, posting progress and then the result, or an error; never throws. */
export function handleRequest(
  gd: GameData, meta: readonly MetaEntry[], cache: Map<string, readonly Diag[]>, req: BuilderRequest, post: (r: BuilderReply) => void,
): void {
  try {
    const result = simulateRoster(gd, req.roster, meta, cache, (done, total) => post({ id: req.id, type: 'progress', done, total }));
    post({ id: req.id, type: 'done', result, metaIds: meta.map((m) => m.speciesId) });
  } catch (err) {
    post({ id: req.id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}
