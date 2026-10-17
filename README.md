# gbl-lab

Pokémon GO Great League lab: a battle engine that matches PvPoke's simulator, a meta matchup matrix, a phone-first battle companion web app, and (later) a battle agent.

## What it does
Simulates a 1v1 Great League matchup turn by turn (shields, energy, buffs, charged-move timing) and reports PvPoke-style battle ratings plus a timeline. It also ranks a species' IV combinations by stat product (`rankIvs` in `src/stats/ivRank.ts`), and those ranks match PvPoke's, including its default IV floors and species level floors.

"Matches PvPoke" here means verified against PvPoke's own code in default simulate mode, with PvPoke's default IVs (`defaultIVs.cp1500`), for the supported species (see Known exclusions). Asymmetric shields, custom IVs and bait settings other than PvPoke's default are not covered by the oracle fixtures.

### Policies
Choose with `--policy`:
- `pvpoke` (default): a port of PvPoke's default-mode decision logic (move timing, bait, shielding). Matches PvPoke's own results.
- `greedy`: throws the first affordable charged move in slot order and always shields. A simple baseline.
- `fast`: only ever uses the fast move and never shields. Used for engine validation.

### Matchup matrix
- `data/matrix-1500.json` (committed) holds the 1v1 battle rating of every meta Pokémon against every other in all 9 shield scenarios. The meta is the top 150 Pokémon in PvPoke's Great League rankings that the engine supports, with PvPoke's ranking movesets and default IVs. `ratings[a][b][aShields][bShields]` is a's rating (0–1000, 500 = even).
- `npm run gen-matrix` rebuilds it (about a minute) and writes `reports/matrix-report.md`, which lists exclusions, timing and a mirror check. `--size N` does a quick run into `.cache/` instead. Rerun it after `npm run update-data` or any engine change; `tests/matrixCommitted.test.ts` fails while it is stale.
- `npm run matrix -- <speciesId> [--shields A B]` prints a meta Pokémon's averages, wins/losses and best/worst matchups.
- `npm run matrix -- --roster my-team.json` does the same for your own Pokémon, simulated on demand (`teamMatrix` in `src/matrix/`). The roster file is a JSON array:
  ```json
  [{ "speciesId": "azumarill", "fastMoveId": "BUBBLE", "chargedMoveIds": ["ICE_BEAM", "PLAY_ROUGH"],
     "ivs": { "atk": 0, "def": 15, "hp": 15 }, "label": "My Azumarill" }]
  ```
  `ivs`, `level` and `label` are optional; defaults are PvPoke's default IVs and the highest level under 1500 CP.

## Battle companion
A web app for use mid-battle (`app/`, logic in `src/companion/`), laid out in three columns on a laptop and one on a phone. Type the opponent's name to get their likely moves (PvPoke's ranking moveset) with fast-move counts (e.g. `4-4-4`), your team ranked against them at the current shields, and a stay/switch and shield suggestion that you confirm with one tap.

- **Switching:** suggested when the Pokémon on the field is losing (under 500) and a teammate rates at least 100 higher.
- **Shields:** advised for each of their charged moves, by simulating them opening with that move while you shield or don't. "Likely first" marks the one PvPoke-style play throws first.
- **Your charged moves:** for the Pokémon on the field, each move's damage as a share of their HP, type multipliers and STAB, side effects, and which to throw first (the move the simulated battle throws first).
 One-tap buttons log shields, faints and switches, with Undo. Your roster and the battle in progress are saved in the browser, so switching to Pokémon GO and back loses nothing. It works offline once loaded and can be added to the iPhone home screen.

- Ratings assume a fresh 1v1 at the current shields: **HP and energy aren't tracked**.
- Only species in PvPoke's Great League rankings are searchable. Opponents the engine can't simulate (e.g. Cramorant) still show moves and counts, with "Can't simulate" instead of ratings.
- Team setup takes the same roster JSON as `npm run matrix -- --roster` (import and export on the Team tab).

Run it:
- `npm run dev` builds `app/public/app-data.json` from `data/` and starts Vite at `http://localhost:5173/gbl-lab/`.
- `npm run build` writes the static site to `dist/`; `npm run preview` serves that build.

Publish (one-time steps, yours to do):
1. In the repo's Settings → Pages, set Source to "GitHub Actions".
2. "Deploy companion to Pages" runs on every push to `main` (so merging a PR deploys), and can also be started by hand from the Actions tab. It runs the full test suite before deploying. The site is served at `https://<owner>.github.io/gbl-lab/`.

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
- Form changes (`tests/fixtures/form-change-oracle.json`): 1,800 Mimikyu/Morpeko cases against corrected PvPoke and 891 Mimikyu cases against unmodified PvPoke, all exact.
- Matchup matrix: `simulateCell` reproduces every one of the 15,150 oracle cases exactly (`tests/matrixCell.test.ts`).

## Known exclusions
- Mimikyu (Disguise) and Morpeko (Hunger Switch) are supported. Morpeko switches form on every charged move, as in the game. PvPoke leaves it in Hangry, so Morpeko results differ from pvpoke.com (ADR 0003).
- Aegislash, Cramorant and other form changers are not supported; the engine rejects them with a typed error.
- Known differences from the real game, fixed and open, are listed in `docs/known-game-differences.md`.
- Mega Pokémon are not supported.
- Meta gaps: unsupported Pokémon (Cramorant, Aegislash, megas and others) are missing from the matrix meta. The `excluded` list in `data/matrix-1500.json` and `reports/matrix-report.md` names them.
- Moves whose damage is a percentage of max HP (`percentMaxHP`) are not supported.
- The CLI has no `--ivs` flag yet (spec section 8); combatants use each species' default Great League IVs.

## Environment variables
None, for the CLI, the tests or the web app.
