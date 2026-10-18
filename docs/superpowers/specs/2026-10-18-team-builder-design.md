# Team builder: design

Date: 2026-10-18
Status: awaiting approval

## Intent

The user wants to know: "given the Pokémon that I have, what are the best, most well-rounded teams I can make from them". pick3.gg does this: you give it your collection and it recommends teams. This feature brings that into the companion app, so it runs on our own simulator, which matches PvPoke exactly.

"Well rounded" means pick3's definition, which the user agreed to after we compared pick3 and PvPoke's team builder (see Prior art). Each team of three plays three roles (lead, safe switch, closer) and is scored on coverage, consistency and safety.

## Goals

- A new **Builder** tab in the companion app, beside Battle and Team.
- **The collection is the Team tab roster** (`SavedApp.roster`). There is no new way to enter Pokémon.
- Recommend the **top 10 teams** from the roster, ranked by score.
  - Each team is shown in its best order: lead, then safe switch, then closer.
  - "Best order" means the order with the highest score, out of all 6.
- **Pins:** the user can pin one or more roster Pokémon (up to 3). Then every recommended team includes all of them.
- **Selected team details:**
  - each member in its role, with its win count in its role scenario;
  - the three sub-scores in plain words;
  - the threats: meta Pokémon that nothing on the team beats.
- **"Use this team"** sets the Team tab's team to those three, in lead, safe switch, closer order, ready for battle. The user saw this in the mockup and kept it.
- Every Pokémon shows its GO icon (`PokemonIcon`, PR #6) next to its name.
- **Laptop layout.** The companion app is used on a laptop, not a phone. The layout is the one the user approved in the mockup:
  - the roster summary and pins across the top;
  - the ranked list on the left (about 40%);
  - the selected team's details on the right.

## Non-goals

- **Meta usage weighting.** Every meta opponent counts equally, because we have no play-rate data. pick3 weights by usage.
- **Stardust, candy or budget.** The roster is Pokémon the user already has.
- **Team styles** (pick3's "ABB" vs "Balanced ABC"). We use one score.
- **Choosing between similar teams.** The user said this doesn't matter: rank by score and nothing else.
- **Tiebreak heuristics or diversity filters.** For example, we don't stop near-duplicate teams from filling the list.
- **Excluding Pokémon.** Only pinning was asked for.
- **Suggesting Pokémon the user doesn't own.** This is PvPoke-style alternatives, or the roadmap's "wanted list".
- **General visual polish of the rest of the app.** That is a separate job.

## Anti-goals

- **Scores that don't match pick3's formula.** The formula below is the spec. Don't "improve" it.
- **A frozen UI while it simulates.** The simulation must run off the main thread and show progress.
- **Phone-first layout.**

## Scoring (pick3's formula, decoded from its app bundle)

**Inputs**

- **Meta:** the same top-150 Great League meta the matrix uses, `buildMeta(gd, rankings, 150)`. Unsupported entries are excluded, as they are today.
- **Ratings:** for each roster Pokémon, a `Cell` against every meta opponent. A Cell holds all 9 shield scenarios: `simulateCell`, i.e. a row of `teamMatrix`.
  - `rating(p, o, s)` is `cell[s][s]`, our Pokémon `p`'s battle rating (0-1000) against opponent `o`, with `s` shields each.

**Scoring one ordered team** `[lead, safe, closer]`

1. **Role scenarios.**
   - Lead: 1-1 shields.
   - Safe switch: 1-1 shields.
   - Closer: 0-0 shields.
2. **Covered opponents.** Opponent `o` is covered if any member `m` has `rating(m, o, roleShields(m)) > 500`.
   - Each (member, opponent) pair where that holds is a **role win**.
   - A role win is **consistent** if that member also has `rating(m, o, 0) > 500` and `rating(m, o, 2) > 500`.
3. **Coverage** = covered opponents ÷ all meta opponents × 100.
4. **Consistency** = consistent role wins ÷ role wins × 100. It is 0 if there are no role wins.
5. **Safety** = max(0, 100 − 20 × A − 10 × B), where:
   - A is the number of meta opponents with `rating(safe, o, 1) < 300` (the safe switch's hard counters);
   - B is the number of the **top 10** meta opponents that are not covered. The top 10 are the first 10 entries of the meta, which is in PvPoke ranking order. pick3 takes the top 10 by usage weight; with equal weights, ranking order is our stand-in (my call).
6. **Score** = 0.5 × coverage + 0.25 × consistency + 0.25 × safety.

**Combining orders and teams**

- A team's score is the best score over its 6 orders. The order that achieves it is the displayed order.
- Rank all teams by score. Show the top 10.

**Rounding and ties**

- pick3 rounds each sub-score and the total for display. We keep full precision for ranking and round to whole numbers for display.
- Ties are broken by roster order, so results are deterministic (my call).

**Which teams are considered**

- Every 3-combination of roster entries that includes all pins.
- A roster entry can't appear twice in one team.
- Two entries with the same Pokédex number can't share a team. This includes shadow and regional forms, so Stunfisk can't be paired with Galarian Stunfisk, and Medicham can't be paired with Shadow Medicham. The user decided this on 2026-10-18.

**Threats** for a team are the meta opponents where every member's rating at 1-1 is ≤ 500, i.e. no member beats it at 1-1.
- They are listed worst first: lowest best-member rating first.
- The details panel shows at least the first 8, each with its icon.

**Sub-score wording in the details panel** (my call; the builder may refine it)

- Coverage: "N of 150 meta opponents beaten by someone in their role".
- Consistency: "X% of those wins still hold at 0-0 and 2-2 shields".
- Safety: "N hard counters to the safe switch · M of the top 10 uncovered".

## Performance

- **Measured cost:** simulating one roster Pokémon against the 150-Pokémon meta in all 9 scenarios takes about 0.43 s on the user's laptop. A 50-Pokémon roster is about 20 s.
- **Scoring cost:** for 50 entries that is 19,600 teams × 6 orders × 150 opponents, which is well under a second.
- **Only simulate what the score uses (my call):** the score reads only the equal-shield scenarios (0-0, 1-1 and 2-2), so the Builder simulates those 3 instead of all 9. That's about 3× faster, roughly 7 s for 50 Pokémon.
- **Where it runs:** the simulation must run in a **Web Worker**, with a progress indicator ("Simulating 12 of 50…").
- **Caching:** results are cached in memory per roster entry, so changing pins, or adding one Pokémon, only simulates what's new.
  - The cache key is the entry's species, moves, IVs and level.
  - Persisting the cache across reloads is not required (my call). Add it if reload cost turns out to annoy.
- **Unsupported roster entries** (Aegislash, Megas, or anything `buildRosterCombatant` rejects) are skipped. The Builder shows a short note naming them.

## Edge cases

- **Fewer than 3 usable roster entries:** show a message pointing to the Team tab. Don't compute.
- **No team satisfies the pins** (all pins share a dex number, for example): say so.
- **Roster changes while a computation runs:** discard the stale result and recompute.

## How it gets made

- **Builds on what exists:**
  - `teamMatrix`, `simulateCell`, `buildMeta`, `buildRosterCombatant` (`src/matrix/`);
  - the app's data loading (`AppData`), state and persistence (`SavedApp.team`, `appState.ts`);
  - `PokemonIcon`.
- **Pure scoring logic** goes in `src/companion/` with unit tests. It must have no DOM or worker code, so it can be tested with hand-made ratings.
- **Tests must cover:**
  - each sub-score on small synthetic rating tables, including the safety floor at 0 and consistency with no wins;
  - best-order selection;
  - pins;
  - the duplicate-dex rule;
  - threat ordering;
  - one app test for the Builder tab rendering ranked teams and "Use this team" setting `SavedApp.team`.
- **Sequencing (my call):** this branch builds on top of the icons branch (PR #6, `PokemonIcon`). If PR #6 merges first, rebase onto main.
- **Pins are not saved** across reloads (my call). They reset when the page reloads.
- **Equal-scoring orders of one team:** take the first in the fixed order list `[0,1,2], [0,2,1], [1,0,2], [1,2,0], [2,0,1], [2,1,0]` over the team's members in roster order, as pick3 does (my call).
- **Left to the builder:** module boundaries, worker plumbing, component structure, and styling within the approved layout.

## Prior art (researched 2026-10-17)

- **pick3.gg:** recommends teams from your collection. The scoring function above is read from its public bundle (`assets/index-*.js`, function scoring each of the 6 orders). Other features we're not copying:
  - usage weights;
  - stardust and candy cost with a budget filter;
  - ABB vs Balanced styles;
  - only one Mega per team.
- **PvPoke team builder** (`js/battle/rankers/TeamRanker.js`, `js/interface/TeamInterface.js`): grades a team you enter (coverage, bulk, safety, consistency letter grades) and suggests per-slot alternatives. It doesn't search a collection.
