/// <reference lib="webworker" />
import { handleRequest, loadFormats, withMoves, type BuilderReply, type BuilderRequest, type Diag } from '../../src/companion';
import type { GameData } from '../../src/data/types';
import { buildMeta, type MetaEntry } from '../../src/matrix/meta';

declare const self: DedicatedWorkerGlobalScope;

// Load the data once; each meta and its cache live as long as the worker, so only new roster entries are simulated.
// One meta and cache per format and set of move overrides: the same Pokémon has different ratings against a different meta.
// ponytail: never evicted; a few overrides a session is a few metas, add an LRU if that grows.
const ready = fetch(`${import.meta.env.BASE_URL}app-data.json`)
  .then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching app-data.json`);
    return res.json();
  })
  .then((file: unknown) => loadFormats(file));
const metas = new Map<string, { gd: GameData; meta: readonly MetaEntry[]; cache: Map<string, readonly Diag[]> }>();
const post = (r: BuilderReply) => self.postMessage(r);

self.onmessage = (e: MessageEvent<BuilderRequest>) => {
  const req = e.data;
  ready.then(
    (formats) => {
      const key = JSON.stringify([req.format, req.moves]);
      let m = metas.get(key);
      if (!m) {
        const app = withMoves(formats[req.format], req.moves);
        m = { gd: app.gd, meta: buildMeta(app.gd, app.ranked, 150).entries, cache: new Map() };
        metas.set(key, m);
      }
      handleRequest(m.gd, m.meta, m.cache, req, post);
    },
    (err: unknown) => post({ id: req.id, type: 'error', message: err instanceof Error ? err.message : String(err) }),
  );
};
