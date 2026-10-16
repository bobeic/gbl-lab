# Matchup Matrix — Design Spec (Sub-project 2)

Date: 2026-10-16
Status: Approved for planning

## 1. Context and intent

### What the user wants (stated)
- Sub-project 2 of the roadmap (`2026-10-15-battle-engine-design.md` §1): "Meta rankings — offline batch producing ranking data artifacts."
- Above all, a **matchup matrix**: how each Pokémon fares against each meta Pokémon, and especially how the user's own team does against the meta.
- No presentation work here. The web app (sub-project 3) comes next and is where the matrix gets shown.

### Agreed decisions
- Precompute meta × meta offline as static data. Compute the user's own Pokémon (exact IVs and moves) against the meta on demand with the same code. This is Approach A; computing everything in the browser and precomputing many IV spreads were both rejected.
- Meta = the top **150 supported** Pokémon in PvPoke's Great League rankings (`data/rankings-1500.json`), with PvPoke's ranking movesets and default IVs.
- All **9 shield scenarios** (0–2 shields each side), even starting energy, PvPoke-like policy.
- **No port of PvPoke's ranking algorithm** (lead/switch/closer/consistency scores, iterative meta weighting). Simple summaries come straight from the matrix.

### Assumptions
- Only 1v1 battles, because the engine has no switching. Cells are 1v1 battle ratings (0–1000, 500 = even), as on pvpoke.com.
- Cramorant, Aegislash, megas and other unsupported Pokémon are missing from the meta and listed as excluded. Cramorant is a real meta gap (it's in Melmetal's top PvPoke matchups) and is recorded here and in the README rather than fixed.

### Measured performance (2026-10-16)
10,000 sims (100 × 100 at 1-1 shields, PvPoke policy) in 2.6 s in Node, about 0.26 ms per sim. So meta × meta (150 × 150 × 9 ≈ 202k sims) takes about 1 minute offline, and one team (3 × 150 × 9 ≈ 4k sims) takes about 1 s.

## 2. Scope

**In scope:** meta selection, the per-pair simulation of all 9 scenarios, the meta-matrix batch and its committed data file, on-demand team matrices, per-row summaries, a debug CLI, tests, and README updates.

**Out of scope:** any UI or HTML report, PvPoke ranking-algorithm parity, 3v3 or switching, uneven starting energy, IV-spread precomputation, wanted-list logic and team scoring (sub-project 3).

## 3. Modules (`src/matrix/`, browser-safe)

All modules under `src/matrix/` must pass `npm run typecheck:browser` (no Node APIs). The rankings JSON is passed in as data; it is never read from disk inside `src/`.

### 3.1 `meta.ts`
```ts
interface MetaEntry {
  readonly speciesId: string;
  readonly moveset: readonly [string, ...string[]]; // [fast, charged...] from PvPoke rankings
  readonly ivs: Ivs;
  readonly level: number;
  readonly cp: number;
}
interface ExcludedEntry { readonly speciesId: string; readonly reason: string; } // "<ErrorName>: <message>"
interface Meta { readonly entries: readonly MetaEntry[]; readonly excluded: readonly ExcludedEntry[]; }

function buildMeta(gd: GameData, rankings: readonly RankingRow[], count: number): Meta;
```
- Walks `rankings` in order and keeps the first `count` entries for which `buildCombatant(gd, { speciesId, fastMoveId, chargedMoveIds })` succeeds. `ivs`, `level` and `cp` come from the built combatant.
- Only `UnsupportedPokemonError` and `GameDataError` mean "exclude". Each exclusion is recorded in `excluded` (ranking order, only those skipped before `count` was reached). Any other error is rethrown.
- A ranking row with an empty or malformed `moveset` throws `GameDataError` naming the species.
- `count` < 1, or not enough supported entries in `rankings`, throws `RangeError` / `GameDataError` respectively.
- `scripts/oracle/meta.ts` (`metaSpecies`) is reimplemented on top of `buildMeta`. Its output and stderr logging stay the same, so existing oracle fixtures are unaffected.

### 3.2 `cell.ts`
```ts
type Cell = readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];
// cell[aShields][bShields] = a's battle rating vs b in that scenario

function simulateCell(gd: GameData, a: Combatant, b: Combatant): Cell;
```
- Runs `runMatchup` once for each of the 9 `[aShields, bShields]` pairs, with a fresh `PvPokeLikePolicy` per side per battle and default start energy. It returns `ratings[0]` from each.
- This is the only simulation entry point used by both the batch and the team path.
- `TurnLimitError` is rethrown wrapped with the pair and scenario in the message (`<a> vs <b> at <sa>-<sb>: ...`).

### 3.3 `teamMatrix.ts`
```ts
interface RosterEntry {
  readonly speciesId: string;
  readonly fastMoveId: string;
  readonly chargedMoveIds: readonly string[];
  readonly ivs?: Ivs;     // default: species default Great League IVs
  readonly level?: number;
  readonly label?: string; // display name, e.g. "Melmetal (my 0/15/14)"
}
interface MatrixRow { readonly id: string; readonly cells: readonly Cell[]; } // cells[j] vs meta.entries[j]

function teamMatrix(gd: GameData, roster: readonly RosterEntry[], meta: readonly MetaEntry[]): MatrixRow[];
```
- All entries are validated up front with `buildCombatant` before any simulation. The first invalid entry throws `RosterError` (new, in `src/errors.ts`) with its index, species and the underlying error message. Invalid entries are never skipped. An unsupported species in the roster is an error here, not an exclusion.
- A roster entry whose CP exceeds 1500 throws `RosterError`.
- `id` is `label` if given, else `speciesId`.
- Meta entries are built from their stored `speciesId`, `moveset`, `ivs` and `level`.

### 3.4 `summary.ts`
```ts
interface RowSummary {
  readonly average: Cell;  // mean rating per scenario, rounded to the nearest integer
  readonly wins: Cell;     // count of opponents with rating > 500 per scenario
  readonly losses: Cell;   // count with rating < 500
}
function summarize(row: MatrixRow): RowSummary;
```
- The 1-1 scenario (`[1][1]`) is the headline number for CLI output. It carries no meta weighting.
- An empty row throws `RangeError`.

### 3.5 Matrix data access (`matrixData.ts`)
- `interface MatrixFile` (§4) plus `parseMatrixFile(json: unknown): MatrixFile`. It validates shape and dimensions (`ratings.length === meta.length`, each inner array 3 × 3, integers 0–1000) and throws `GameDataError` with the offending path on any mismatch.
- `metaRow(file, speciesId): MatrixRow` returns a meta Pokémon's row from the committed data. An unknown id throws `GameDataError`.

## 4. Batch: `npm run gen-matrix` (`scripts/gen-matrix.ts`)

1. Load game data (`loadDefaultGameData`) and `data/rankings-1500.json`.
2. Read `data/UPSTREAM` (the PvPoke commit that `data/gamemaster.json` and `data/rankings-1500.json` were vendored from) and refuse to run if it's missing or not a 40-character hex SHA. It's stored in the output as `upstream`, so a later `update-data` makes the committed matrix detectably stale (§5, §7).
3. `buildMeta(gd, rankings, 150)`. Log each exclusion to stderr.
4. For every ordered pair `(a, b)`, including `a === b`: `simulateCell`. Every ordered pair is simulated, because PvPoke rates each matchup from both sides and the two sides aren't guaranteed to mirror exactly (Charge Move Priority ties, policy asymmetries).
5. Write `data/matrix-1500.json` (committed; compact JSON, no indentation):
   ```
   {
     "upstream": "<data/UPSTREAM>",
     "generatedWith": { "metaSize": 150, "policy": "pvpoke", "startEnergy": [0, 0] },
     "meta": [MetaEntry, ...],
     "excluded": [ExcludedEntry, ...],
     "ratings": number[a][b][aShields][bShields]
   }
   ```
   Expected size: about 1 MB raw, about 200 KB gzipped.
6. **Mirror check (recorded, not asserted):** for each unordered pair and scenario, compare `ratings[a][b][sa][sb] + ratings[b][a][sb][sa]` with 1000. Write `reports/matrix-report.md` with the run date, meta size, exclusions, elapsed time, and the count and up to 20 examples of cells off by more than 1. If the count isn't near zero, investigate before sub-project 3 relies on it.

`--size N` overrides 150 (for quick local runs). The committed file is always produced at the default size.

## 5. Debug CLI: `npm run matrix` (`scripts/matrix.ts`)

- `npm run matrix -- <speciesId>` prints the meta Pokémon's row from `data/matrix-1500.json`: its summary (1-1 average, wins/losses for each of 0-0, 1-1, 2-2), then its 10 best and 10 worst opponents at 1-1 with ratings.
- `npm run matrix -- --roster <file.json>` reads a JSON array of `RosterEntry`, runs `teamMatrix` against the committed meta, and prints the same for each roster entry.
- `--shields A B` changes the scenario used for the best/worst lists (default `1 1`).
- An unknown species, a missing or invalid roster file, or a stale matrix (its `upstream` ≠ `data/UPSTREAM`) exits non-zero with a message.

This CLI is only for checking output. The real view is sub-project 3.

## 6. Error handling summary

| Situation | Behaviour |
|---|---|
| Meta candidate unsupported / bad data | Excluded, logged, listed in `excluded` |
| Any other error while building the meta | Batch fails |
| Sim exceeds turn limit | Batch fails, naming the pair and scenario |
| `data/UPSTREAM` missing or invalid | Batch refuses to run |
| Committed matrix `upstream` ≠ `data/UPSTREAM` | CLI refuses to read; test fails |
| Invalid roster entry (incl. unsupported species, CP > 1500) | `RosterError` naming the entry; nothing simulated |
| Malformed matrix file | `GameDataError` naming the path |

## 7. Testing

- **Oracle agreement:** for every case in `tests/fixtures/oracle-gl.json` where both Pokémon are meta entries, `simulateCell` gives exactly PvPoke's ratings for that scenario. This proves side and scenario indexing is right.
- **Committed matrix is current:** re-simulate a fixed, deterministic sample of 200 `(a, b)` pairs (every k-th ordered pair by index, k chosen so 200 are covered, including some `a === b` pairs) (all 9 scenarios each) and compare with `data/matrix-1500.json`. Also check that `upstream` equals `data/UPSTREAM` and the file parses with `parseMatrixFile`.
- **Team path = batch path:** a roster entry made from a meta entry's species, moveset, IVs and level gives exactly that entry's committed row (checked for a few entries, including Mimikyu and Morpeko).
- **Unit tests:** `buildMeta` (ordering, exclusion of an unsupported species, rethrow of other errors, not enough entries); `teamMatrix` (`RosterError` for an unknown species, an illegal move, invalid IVs, CP over cap, an unsupported species; `id`/`label`); `summarize` (averages, wins/losses, ties at 500 counted as neither, empty row); `parseMatrixFile` (each shape error).
- **CLI test** in the style of `tests/simCli.test.ts`: species row, roster file, bad species, bad roster.
- `npm test` and `npm run typecheck` (including `typecheck:browser`) pass.

## 8. Docs
- README: what the matrix is, `npm run gen-matrix`, `npm run matrix`, the roster file format, and a "Meta gaps" note (Cramorant, Aegislash, megas excluded; see `excluded` in the data file).
- Roadmap note in `2026-10-15-battle-engine-design.md` §1: sub-project 2 became the matchup matrix (this spec), and a PvPoke ranking-algorithm port is deferred.
