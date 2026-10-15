# gbl-lab

Pokémon GO Great League lab: a battle engine that matches PvPoke's simulator, and (later) a team builder and battle agent.

## What it does
Simulates a 1v1 Great League matchup turn by turn (shields, energy, buffs, charged-move timing) and reports PvPoke-style battle ratings plus a timeline.

### Policies
Choose with `--policy`:
- `pvpoke` (default): a port of PvPoke's default-mode decision logic (move timing, bait, shielding). Matches PvPoke's own results.
- `greedy`: throws the first affordable charged move in slot order and always shields. A simple baseline.
- `fast`: only ever uses the fast move and never shields. Used for engine validation.

## Run locally
- `npm install`
- `npm run sim -- medicham azumarill --shields 1 1` runs a matchup and prints a timeline.
- Flags: `--shields A B` (integers 0-2, default 1 1), `--policy pvpoke|greedy|fast`, `--moves-a F,C1,C2` / `--moves-b F,C1,C2` (default: the species' ranking moveset), `--trace`.
- `--trace` prints the PvPoke policy's decision log under the timeline (both sides, interleaved). It is an error with `greedy` or `fast`.
- Unknown species, policies or malformed shields exit non-zero with a message.

## Tests
- `npm test` runs the full suite, including the PvPoke oracle acceptance tests. The decision and oracle tests need the PvPoke checkout in `.cache/pvpoke` (see Data).
- `npm run typecheck`

## Data and oracle
- `npm run update-data -- <pvpoke-commit>` refreshes `data/` from PvPoke and checks out PvPoke into `.cache/pvpoke`, which the oracle scripts need.
- `npm run gen-oracle` regenerates the engine fixtures in `tests/fixtures/` from PvPoke's own simulator.
- `npm run gen-decision-oracle` regenerates the move-metadata and shield-decision fixtures.
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
