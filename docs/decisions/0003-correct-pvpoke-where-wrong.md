# 0003 — Correct PvPoke where it is wrong about the real game

Status: accepted (2026-10-15)

Context: ADR 0002 makes PvPoke's semantics the default, and exact parity with PvPoke is the engine's main correctness check. The user wants the engine to model the game as it is actually played. While adding Morpeko, we found that PvPoke switches it to Hangry once and never back, whereas the game switches it on every charged move.

Decision: PvPoke stays the default. A deviation is allowed only when PvPoke contradicts the real game, backed by sources. Every data deviation is listed in `src/data/corrections.ts` with its reason. The loader applies the list, and the oracle harness patches PvPoke's gamemaster with the same objects (`scripts/oracle/load.ts`), so exact-parity testing continues against a corrected PvPoke. A check against unmodified PvPoke confirms that each correction touches only its own species. Differences we know about but haven't fixed, mostly in decision logic, are tracked in `docs/known-game-differences.md`.

Consequences: Results involving corrected species no longer match pvpoke.com. The README says so. Today the only corrected species is Morpeko. Decision-logic differences (e.g. stale damage estimates) are not corrected under this ADR; they are left to a future decision policy that's allowed to beat PvPoke.
