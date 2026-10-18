import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('workerSimulate', () => {
  it('rejects pending requests when the worker crashes, then starts a new worker', async () => {
    const workers: { onerror: ((e: unknown) => void) | null; postMessage: () => void }[] = [];
    vi.stubGlobal('Worker', class {
      onerror: ((e: unknown) => void) | null = null;
      onmessage = null;
      postMessage() {}
      constructor() { workers.push(this); }
    });
    const { workerSimulate } = await import('../../app/src/builderClient');
    const pending = workerSimulate([], () => {});
    workers[0]!.onerror!({ message: 'failed to load' });
    await expect(pending).rejects.toThrow(/worker/i);
    void workerSimulate([], () => {}).catch(() => {});
    expect(workers.length).toBe(2);
  });
});
