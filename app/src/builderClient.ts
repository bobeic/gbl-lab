import type { BuilderReply, BuilderRequest } from '../../src/companion';
import type { Simulate } from './screens/BuilderScreen';

type Result = Awaited<ReturnType<Simulate>>;
interface Pending {
  readonly resolve: (r: Result) => void;
  readonly reject: (err: Error) => void;
  readonly onProgress: (done: number, total: number) => void;
}

let worker: Worker | undefined;
let nextId = 0;
const pending = new Map<number, Pending>();

function onReply(e: MessageEvent<BuilderReply>) {
  const r = e.data;
  const p = pending.get(r.id);
  if (!p) return;
  if (r.type === 'progress') return p.onProgress(r.done, r.total);
  pending.delete(r.id);
  if (r.type === 'done') p.resolve({ ...r.result, metaIds: r.metaIds });
  else p.reject(new Error(r.message));
}

/** Simulate the roster in the Builder's web worker, created on first use. */
export const workerSimulate: Simulate = (roster, onProgress) => {
  if (!worker) {
    worker = new Worker(new URL('./builderWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = onReply;
    // A worker that fails to load or crashes would leave every request hanging: fail them, and start afresh next time.
    worker.onerror = (e) => {
      worker = undefined;
      for (const p of pending.values()) p.reject(new Error(`Simulation worker failed: ${e.message || 'unknown error'}`));
      pending.clear();
    };
  }
  const id = nextId++;
  const req: BuilderRequest = { id, roster };
  return new Promise<Result>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    worker!.postMessage(req);
  });
};
