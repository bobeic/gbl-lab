// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  test: { include: ['tests/**/*.test.{ts,tsx}'], testTimeout: 600_000 },
});
