# gbl-lab

Pokémon GO Great League lab: a battle engine that matches PvPoke's simulator, and (later) a team builder and battle agent.

## What it does
Simulates a 1v1 Great League matchup turn by turn (shields, energy, buffs, charged-move timing) and reports PvPoke-style battle ratings plus a timeline. It also ranks a species' IV combinations by stat product (`rankIvs` in `src/stats/ivRank.ts`), and those ranks match PvPoke's, including its default IV floors and species level floors.

"Matches PvPoke" here means verified against PvPoke's own code in default simulate mode, with PvPoke's default IVs (`defaultIVs.cp1500`), for the supported species (see Known exclusions). Asymmetric shields, custom IVs and bait settings other than PvPoke's default are not covered by the oracle fixtures.

### Policies
Choose with `--policy`:
- `pvpoke` (default): a port of PvPoke's default-mode decision logic (move timing, bait, shielding). Matches PvPoke's own results.
- `greedy`: throws the first affordable charged move in slot order and always shields. A simple baseline.
- `fast`: only ever uses the fast move and never shields. Used for engine validation.

## Run locally
- `npm install`
- Fresh clone: `npm run update-data -- $(cat data/UPSTREAM)` checks out the pinned PvPoke commit into `.cache/pvpoke` (gitignored), which the oracle tests need.
- `npm run sim -- medicham azumarill --shields 1 1` runs a matchup and prints a timeline.
- Flags: `--shields A B` (integers 0-2, default 1 1), `--policy pvpoke|greedy|fast`, `--moves-a F,C1,C2` / `--moves-b F,C1,C2` (default: the species' ranking moveset; the flag without a value is an error), `--trace`.
- `--trace` prints the PvPoke policy's decision log under the timeline (both sides, interleaved). It is an error with `greedy` or `fast`.
- Unknown species, policies or malformed shields exit non-zero with a message.

## Tests
- `npm test` runs the full suite, including the PvPoke oracle acceptance tests.
- `tests/pvpokeDecide.test.ts` runs PvPoke live through the harness, so it needs the PvPoke checkout in `.cache/pvpoke` (see Run locally). Without the checkout it **fails**; it is not skipped. Every other oracle test reads committed fixtures in `tests/fixtures/` and does not need the checkout. The fixture tests also check that each fixture's `upstream` matches `data/UPSTREAM`.
- `npm run typecheck` type-checks everything under Node types. It then runs `npm run typecheck:browser`, which checks `src/` alone with DOM types and no Node types, so engine code stays browser-safe. `src/data/node.ts` (`loadDefaultGameData`, which reads the file system) is the one Node-only module. The `src/data` barrel does not re-export it.

## Data and oracle
- `npm run update-data -- <pvpoke-commit>` refreshes `data/` from PvPoke and checks out PvPoke into `.cache/pvpoke`, which the oracle scripts need.
- `npm run gen-oracle` regenerates the engine fixtures in `tests/fixtures/` from PvPoke's own simulator.
- `npm run gen-decision-oracle` regenerates the move-metadata and shield-decision fixtures.
- `npm run gen-iv-oracle` regenerates `tests/fixtures/iv-rank-oracle.json` from PvPoke's `Pokemon.generateIVCombinations`.
- `scripts/oracle/meta.ts` logs each species it excludes from the oracle set to stderr, with the error class and message.
- `npm run compare-oracle` runs the default policy against PvPoke and writes `reports/oracle-report.md`.

### Oracle results
From the latest `npm run compare-oracle` (`reports/oracle-report.md`):
- Cases: 15,150 matchups
- Exact matches (both ratings identical): 15,150
- Winner agreement: 100.00% (target >= 98%)
- Median rating difference: 0 (target <= 25)

## Known exclusions
- Form-changing Pokémon (Aegislash, Cramorant, Mimikyu, Morpeko) are not supported; the engine rejects them with a typed error.
- Mega Pokémon are not supported.
- Moves whose damage is a percentage of max HP (`percentMaxHP`) are not supported.
- The CLI has no `--ivs` flag yet (spec section 8); combatants use each species' default Great League IVs.

## Environment variables
None.
