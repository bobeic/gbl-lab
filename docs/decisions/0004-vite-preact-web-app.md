# 0004 — Vite + Preact for the battle companion web app

Status: accepted (2026-10-16)

Context: The battle companion is used mid-battle on an iPhone, flipping back and forth with Pokémon GO. It has to start fast on a phone, work offline, and run the existing TypeScript engine in the browser (ADR 0001). No server.

Decision: Build it with Vite and Preact in `app/`, sharing `src/` with the engine. Preact keeps the bundle small (about 10 KB gzipped for the UI) for fast startup, while still offering components and hooks. Vite is pinned to 5 so it stays compatible with vitest 2. Game data is trimmed into one JSON file at build time and fetched at startup; ratings are simulated on demand.

Consequences: One toolchain for app and tests; app tests run in vitest with jsdom. Moving to Vite 6 waits on a vitest upgrade.
