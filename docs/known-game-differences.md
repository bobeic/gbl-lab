# Known differences from the real game

A running list of places where gbl-lab (mostly by following PvPoke) behaves differently from Pokémon GO Battle League as actually played. The engine follows PvPoke by default (ADR 0002). An item is fixed only when it is clearly wrong about the game, and every fix is listed in `src/data/corrections.ts` and patched identically in the PvPoke oracle (ADR 0003).

Status: **fixed** (we deviate from PvPoke to match the game), **open** (known, not yet worked on), **out of scope** (not modelled yet).

## Battle mechanics

| # | Difference | Status | Notes |
|---|---|---|---|
| M1 | PvPoke switches Morpeko to Hangry after its first charged move and never back. In the game it switches on every charged move. | fixed (form-changes sub-project) | `corrections.ts` gives `morpeko_hangry` a rule back to Full Belly. |
| M2 | Aegislash, Cramorant and other form changers whose forms differ in stats, or that use other triggers, are not supported. | out of scope | Rejected with `UnsupportedPokemonError`. |
| M3 | Mega Pokémon and moves whose damage is a percentage of max HP are not supported. | out of scope | Rejected with `UnsupportedPokemonError`. |
| M4 | Battles are 1v1 only: no switching, switch timer or faint replacement. | out of scope | Needed for 3v3. When added: Morpeko returns to Full Belly on switch; busted Mimikyu stays busted and keeps its −1 Defense; ordinary stat changes reset. |
| M5 | The order of events within a turn for form changes (buffs, then attacker form change, then defender form change) follows PvPoke's code. It is not confirmed by official patch notes. | open (unverified) | Outcomes don't depend on it today, because Morpeko's types don't change and Mimikyu's bust happens after the hit lands. |

## Decision logic (how the simulated players choose)

These don't change what a move does, only what the simulated player chooses. They matter most for coaching and play-vs-agent, where decisions should be better than PvPoke's.

| # | Difference | Status | Notes |
|---|---|---|---|
| D1 | Damage estimates go stale. Each move's damage is computed at battle start and refreshed only when the move is used, when the Pokémon changes form, or when certain decision checks rewrite it. Any stat change in between (Aura Wheel, Icy Wind, Psychic Fangs, Mimikyu's bust…) leaves the estimate out of date, so close "can I KO now?" calls can be wrong. | open | A real player would re-evaluate. The fix is to recompute damage fresh. It breaks exact pvpoke.com parity, so it belongs with a better decision policy. Engine spec §10 (decideAction `move.damage`). |
| D2 | Damage-per-energy used for choosing between charged moves is frozen at battle start (or the last form change) and ignores later stat changes. | open | Same root cause as D1. Engine spec §10 (move metadata). |
| D3 | Shielding is simplistic: shield whenever shields remain, except for a few bait and self-debuff cases. Real players save shields, read baits, and weigh the rest of the game. | open | Engine spec §10 (shields in simulate mode). |
| D4 | Mimikyu's shield decision ignores its disguise, so it may shield a hit the disguise would have blocked for free. Shielding does keep the disguise and avoid its −1 Defense, so this is arguable rather than wrong. | open (arguable) | Kept as PvPoke by choice. |
| D5 | The simulated players know each other's exact energy and movesets. Real players can count energy but often don't know the opponent's moveset until it's used. | open | Relevant to coaching realism. |
| D6 | PvPoke's knockout planner has quirks that make it cruder than intended: dominance pruning never fires, every plan is treated as certain, and it stops at the first knockout plan found. | open | Engine spec §10 (decideAction DP quirks). |
| D7 | The Melmetal-vs-Cresselia special case compares species names, so it never fires for shadow forms. | open | Engine spec §10. |
