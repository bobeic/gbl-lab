/// <reference lib="webworker" />
import { FORMATS, handleRequest, loadFormats, type BuilderReply, type BuilderRequest, type Diag, type FormatId } from '../../src/companion';
import { buildMeta } from '../../src/matrix/meta';

declare const self: DedicatedWorkerGlobalScope;

// Load the data and build each format's meta once; the caches live as long as the worker, so only new roster entries are simulated.
// One cache per format: the same Pokémon has different ratings against a different meta.
const ready = fetch(`${import.meta.env.BASE_URL}app-data.json`)
  .then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching app-data.json`);
    return res.json();
  })
  .then((file: unknown) => {
    const formats = loadFormats(file);
    return new Map(FORMATS.map((f) => [f.id, { gd: formats[f.id].gd, meta: buildMeta(formats[f.id].gd, formats[f.id].ranked, 150).entries }]));
  });
const caches = new Map<FormatId, Map<string, readonly Diag[]>>(FORMATS.map((f) => [f.id, new Map()]));
const post = (r: BuilderReply) => self.postMessage(r);

self.onmessage = (e: MessageEvent<BuilderRequest>) => {
  const req = e.data;
  ready.then(
    (metas) => {
      const { gd, meta } = metas.get(req.format)!;
      handleRequest(gd, meta, caches.get(req.format)!, req, post);
    },
    (err: unknown) => post({ id: req.id, type: 'error', message: err instanceof Error ? err.message : String(err) }),
  );
};
