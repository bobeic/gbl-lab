import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

describe('production build', () => {
  beforeAll(() => {
    execSync('npm run build', { stdio: 'pipe' });
  }, 300_000);

  it('writes an installable manifest scoped to the Pages base path', () => {
    const manifest = JSON.parse(readFileSync('dist/manifest.webmanifest', 'utf8'));
    expect(manifest.start_url).toBe('/gbl-lab/');
    expect(manifest.scope).toBe('/gbl-lab/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(['192x192', '512x512']);
  });

  it('precaches the app data in the service worker so it works offline', () => {
    expect(existsSync('dist/sw.js')).toBe(true);
    expect(readFileSync('dist/sw.js', 'utf8')).toContain('app-data.json');
  });

  it('links the home-screen icon for iOS', () => {
    const html = readFileSync('dist/index.html', 'utf8');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('apple-mobile-web-app-capable');
  });
});
