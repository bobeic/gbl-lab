# gbl-lab

Pokémon GO Great League lab: a battle simulator that matches PvPoke, and (later) a team builder and battle agent.

## Run locally
- `npm install`
- `npm run sim -- medicham azumarill --shields 1 1` — simulate a matchup and print a timeline.

## Tests
- `npm test` — full suite, including the PvPoke oracle acceptance test.
- `npm run typecheck`

## Data
- `npm run update-data -- <pvpoke-commit>` refreshes `data/` from PvPoke and checks out PvPoke into `.cache/pvpoke` (needed by the oracle scripts).
- `npm run gen-oracle` regenerates `tests/fixtures/` from PvPoke's own simulator.
- `npm run compare-oracle` writes `reports/oracle-report.md` with the worst mismatches.

## Environment variables
None.
