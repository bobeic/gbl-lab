/// <reference lib="webworker" />
import { handleRequest, loadAppData, type BuilderReply, type BuilderRequest, type Diag } from '../../src/companion';
import { buildMeta } from '../../src/matrix/meta';

declare const self: DedicatedWorkerGlobalScope;

// Load the data and build the meta once; the cache lives as long as the worker, so only new roster entries are simulated.
const ready = fetch(`${import.meta.env.BASE_URL}app-data.json`)
  .then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching app-data.json`);
    return res.json();
  })
  .then((file: unknown) => {
    const app = loadAppData(file);
    return { gd: app.gd, meta: buildMeta(app.gd, app.ranked, 150).entries };
  });
const cache = new Map<string, readonly Diag[]>();
const post = (r: BuilderReply) => self.postMessage(r);

self.onmessage = (e: MessageEvent<BuilderRequest>) => {
  const req = e.data;
  ready.then(
    ({ gd, meta }) => handleRequest(gd, meta, cache, req, post),
    (err: unknown) => post({ id: req.id, type: 'error', message: err instanceof Error ? err.message : String(err) }),
  );
};
