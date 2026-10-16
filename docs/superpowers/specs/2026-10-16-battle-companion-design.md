# Battle Companion: Design Spec (Sub-project 3)

Date: 2026-10-16
Status: Draft

## 1. Context and intent

### What the user wants (stated)
- **Help during a battle, not a team builder.** "The team builder is still nice but there is already stuff out there." The roadmap's sub-project 3 (team builder) is replaced by this. Team-builder features (best teams, threats, team diff, wanted list) are deferred.
- Today, mid-battle, they look up the opponent's best moveset on PvPoke. That's too slow.
- They want fast-move counts, the opponent's and their own, "as quickly and easily as possible".
- They want to understand matchups that the types get wrong. For example, Araquanid does fine against Melmetal even though Thunder Shock is super effective on it.
- They want to know when to switch, and to whom.
- They play on an **iPhone**. They review designs on a laptop.

### Agreed with the user
- **One opponent at a time.** They type the opponent's name into a quick search when it appears. Opponents already seen in this battle stay as tabs.
- **Opponent card.** It shows the opponent's likely fast move (energy and turns) and two charged moves, each with its count sequence (e.g. `4-4-4`, `5-4-5`). "Likely moves" means PvPoke's ranking moveset (user confirmed), and only that one moveset is shown.
- **Your team against them.** The card lists the user's Pokémon best-first against this opponent. Each row has the 0–1000 battle rating (500 is even, from the user's side), the user's own counts, and a short type reason when types are misleading.
- **Suggest, then confirm.** The app suggests (1) which of the user's Pokémon does best, (2) stay or switch when the current matchup is losing, and (3) which of the opponent's charged moves to shield. The user confirms with one tap ("Switched to X" or "Stayed in").
- **One-tap log.** Buttons for *I shielded*, *They shielded*, *Mine fainted*, *Theirs fainted* and *They switched* keep track of the shield counts and who is on the field. Suggestions then use the real shield state. The user said "yep that sounds good" to this flow.
- **Build the web app first.** HP and energy are not tracked. The user wants to see in practice how much they can realistically tap mid-battle before adding more tracking.
- Mockups the user approved as "a good starting point": the private artifact https://claude.ai/artifact/UmkPdb5wqvMyXMKPfzvYUu (opponent card, rating scale, shield table, suggest/confirm/track screen).

### Considered and dropped
- **Emulator:** Pokémon GO blocks emulators and bans accounts that use them.
- **Screen-reading overlay** (reads HP bars and energy live): Android-only, and the user has an iPhone. It would be a separate native project, and it sits in a greyer area of Niantic's rules. It might come back later as a front end feeding the same advice logic.
- **Timer-based energy estimate:** it drifts whenever the opponent stops attacking or switches, and confident wrong numbers break the anti-goal below.

### Anti-goals
- **Wrong advice is worse than none.** When the app can't simulate something (an unsupported Pokémon) or the call is too close to make, it says so plainly instead of guessing.
- **Slow is a failure.** The user switches out of Pokémon GO to use this mid-battle. A search that lags, or a page that loses its state when they come back, makes the app useless.

## 2. How it gets made (my calls, not discussed in detail)

- **A static web app** in the existing repo, built with **Vite + Preact + TypeScript (strict)**. It runs the existing engine in the browser, following ADR 0001, with no server. It is hosted on **GitHub Pages**. The user chose to make the `bobeic/gbl-lab` repo public for this, because free Pages needs a public repo and HTTPS is required for Add to Home Screen and offline use.
- **Phone-first layout** sized for an iPhone in portrait. iPhones have no split screen, so the user flips between apps. Mockups during design can be desktop-sized (the user's preference).
- **Installable and offline.** "Add to Home Screen" support (web manifest) plus a service worker, so it opens instantly and works on poor signal.
- **State persists across app switches.** iOS Safari may reload a page in the background. The roster and the current battle (opponents seen, shields, who's on the field, the log) are saved to `localStorage` after every change and restored on load.
- **Game data is bundled.** A build step trims `data/gamemaster.json` and `data/rankings-1500.json` down to what the app needs: species, moves, and each species' ranking moveset and rank. The precomputed `data/matrix-1500.json` is not needed, because ratings for the user's team are simulated on demand. A cell is 9 sims at about 0.26 ms each, so a 3-Pokémon team takes under 10 ms per opponent.

## 3. Screens

### 3.1 Team setup (before battle)
- The user sets up their team once, before battle. A team is 3 Pokémon **in order: lead first** (the user: "I would always have my team inputted so you would know who the lead is"). Each has species, fast move, 2 charged moves, and real IVs (level defaults to the highest under 1500 CP, as in `teamMatrix`).
- Moves default to the species' ranking moveset when the species is chosen.
- **Import/export:** paste or copy the roster JSON format the matrix CLI already uses (`parseRoster` in `src/matrix/teamMatrix.ts`), so a roster built elsewhere can be loaded.
- The user may store a handful of Pokémon and pick which 3 make up the current team. *My call:* a saved list of Pokémon plus one active team of 3. Multiple saved teams are out of scope for v1.

### 3.2 Battle screen (the main screen)
- **Status bar:** shield pips for both sides (starting at 2–2) and who is on the field.
- **Opponent search:** prefix match on species name, in PvPoke ranking order. *My call:* only the species in PvPoke's Great League rankings (1,153 entries, shadows included) are searchable. Unranked species have no likely moveset, and guessing one would break the "wrong advice" anti-goal. They almost never show up in Great League anyway. Shadow and other forms are separate entries (e.g. "Medicham (Shadow)"). *My call:* add a one-tap shadow toggle on a result instead of separate entries, if that's simpler to use. The builder picks whichever is faster to use. Picking a result adds an opponent tab and makes it current. There are at most 3 opponent tabs.
- **Opponent card:** name, types, fast move (type, energy per use, turns), and each charged move (type, energy cost, count sequence).
- **Your team:** each of the user's Pokémon against the current opponent, sorted by rating at the **current shield state**, best first. Each row shows:
  - the rating, colored green (win), amber (450–550, coin flip) or red (loss);
  - the user's own count sequences;
  - a short type reason (§4.4) where one applies.
- **Suggestion box** (§4.2, §4.3), with confirm buttons.
- **Log buttons:** *I shielded*, *They shielded*, *Mine fainted*, *Theirs fainted*, *They switched* (which opens the search). Each tap updates the state and is undoable. *My call:* one Undo button for the last log action, because a mis-tap mid-battle must be cheap to fix.
- **New battle:** resets the opponent tabs, shields and log, and keeps the team.
- *My call:* the 3×3 shield table (mockup section 3) opens from a small details icon on a team row. It is not shown by default.

### 3.3 Who is on the field
The user's words: "I will switch when I'm meant to switch and then if I faint I can say so." They left the mechanics to me. *My calls:*
- **Mine:** a new battle starts with the team's lead on the field.
  - Confirming a suggested switch moves the suggested Pokémon in.
  - Each team row also has a small **Switch in** button, for switches the app didn't suggest.
  - After *Mine fainted*, the app marks that Pokémon fainted. If two remain, it asks "Who's in?", showing the two with the better-rated one first. If one remains, it goes in automatically.
  - The faint pause in the game gives the user time for that tap.
- **Theirs:** the opponent tab currently open is the one on the field. *They switched* opens the search, or the user taps an earlier tab. *Theirs fainted* marks the open tab fainted and opens the search.
- Every one of these actions goes through the same Undo.

### 3.4 Rating explainer
A short static explanation of the 0–1000 scale, reachable from the battle screen (mockup section 2).

## 4. Logic

### 4.1 Count sequences
- For a fast move with energy gain `g` and a charged move costing `c`, the sequence is the number of fast moves to reach `c` energy for the 1st, 2nd and 3rd throw. Leftover energy carries over, and energy is capped at 100 as in the game.
- Example: Psycho Cut (9) to Ice Punch (40) gives 5-4-5 (45 → 5 left → 4 more = 41 → 1 left → 5 more = 46).
- These must match PvPoke's displayed counts for the ranking movesets. Tests should pin a set of known values, including the mockup values in §6.

### 4.2 Best Pokémon and stay/switch
- A rating is the existing `simulateCell` result (PvPoke-like policy, even starting energy, full HP) read at the current shields: `[myShields][theirShields]`.
- **The ratings assume a fresh 1v1 at the current shields.** HP and energy aren't tracked, and the UI says so in one line.
- **Stay/switch:** if the Pokémon on the field rates below 500 and a teammate (not fainted) rates at least 500 *and* at least 100 points higher, the app suggests switching to that teammate. Otherwise it suggests staying. *My call:* the 100-point margin keeps it from suggesting a switch over noise. The thresholds are constants, so they're easy to tune.
- The app doesn't model switch timers, losing a switch, or the opponent's back line. Those are out of scope.

### 4.3 Shield advice
- This must come from simulation, not a rule of thumb. For the current matchup at the current shields, the app runs the PvPoke-like policy twice for the user's side:
  - once forcing the user to **shield** the opponent's first charged move;
  - once forcing them **not** to shield it.

  It records which move the opponent threw first and the user's rating in each case.
- **Advice:** "Shield their first {move}" or "Let their first {move} through", whichever rates higher, with both ratings shown. If the two ratings are within 50 points, or the user has no shields, there's no shield line, or it says "Shield call is close". *My call:* the 50-point threshold.
- **Implementation:** wrap `PvPokeLikePolicy` so `chooseShield` returns a forced answer the first time it's asked and defers to PvPoke after that. This fits the existing `Policy` interface (`src/policy/types.ts`) and needs no engine changes.
- The "shield Dynamic Punch, not Double Iron Bash" line in the mockup is a placeholder and must not be copied.

### 4.4 Type reasons
- A short line when types are misleading. *My call* on the rules:
  - if the opponent's fast move is super effective against your Pokémon but you rate at least 500, explain why: which of their charged moves you resist, or that their fast move is weak;
  - if all of the opponent's moves are neutral or resisted but you rate below 450, name what beats you (e.g. bulk or move pressure).
- Effectiveness comes from the type chart in `src/data/typeChart.ts`, including double resistances. The builder can refine the wording but must not state anything the data doesn't support.

### 4.5 Unsupported Pokémon
- Some species can't be simulated (e.g. form-changers such as Cramorant and Aegislash, which throw `UnsupportedPokemonError`). The opponent card still shows their moves and counts. The team section says "Can't simulate {species}", with no ratings and no suggestions.
- If one of the user's own Pokémon is unsupported, the app rejects it at team setup with the error message.

## 5. Scope

**In v1:** team setup with import/export; opponent search and tabs; the opponent card with counts; team ratings at the current shields; stay/switch and shield suggestions with confirm buttons; the one-tap log with undo; state saved across app switches; offline/installable; a static build and a GitHub Pages deploy config.

**Out of v1:**
- HP and energy tracking;
- opponent moveset alternatives;
- 3v3 look-ahead, switch timers, the opponent's back line;
- other leagues;
- team-builder features (best teams, threats, team diff, wanted list);
- the overlay or OCR;
- accounts and sync.

## 6. Verification

- Unit tests (vitest) cover count sequences, the stay/switch rule, the shield-advice wrapper, battle-state reducers (log, undo, faint, switch), persistence round-trip and search ranking.
- Known values from the engine (1 shield each) pin the rating tests:
  - Araquanid vs Melmetal 518;
  - Medicham vs Melmetal 507;
  - Azumarill vs Melmetal 321;
  - the Araquanid vs Melmetal grid `[[602,373,178],[687,518,428],[772,610,445]]`.
- Count tests use these known values:
  - Medicham: Psycho Cut 9e/2t; Ice Punch 5-4-5; Dynamic Punch 5-5-5;
  - Melmetal: Double Iron Bash 4-4-4; Dynamic Punch 5-5-5;
  - Araquanid: Water Pulse 5-4-4; Mirror Coat 4-4-4;
  - Azumarill: Ice Beam 5-5-5; Play Rough 6-5-6;
  - Mimikyu: Shadow Sneak 7-6-6; Play Rough 8-7-8.
- `npm run typecheck` stays clean, and app code is browser-only.
- A manual check on an iPhone before calling it done. *My call:* the builder records the result in the PR.

## 7. Left to the builder
- The UI component structure, styling and exact copy (keeping the approved mockups' layout and colors).
- The shape of the trimmed data file and the build script that makes it.
- Whether the shadow toggle is a separate result or a button (§3.2).
- The deploy workflow details. **Pushing a deploy is the user's call;** prepare it, but don't publish without asking.
- Updating the README (how to run the app and how to build it) and adding an ADR for Vite + Preact.
