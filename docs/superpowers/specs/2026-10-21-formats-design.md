# Formats (Great League and Fantasy Cup): design

Date: 2026-10-21
Status: approved in chat

## Intent

The user is playing the new Great League **Fantasy Cup**: only Dragon, Steel and Fairy Pokémon, megas excluded. PvPoke ranks it separately, and some Pokémon run different moves there (Turtonator: Dragon Claw/Overheat instead of Brutal Swing/Dragon Claw). The companion app should work for Fantasy as it does for open Great League, switched by a format picker at the top, like PvPoke's.

## Goals

- **Format picker** at the top of the app: Great League, Fantasy Cup. The choice is remembered.
- **One shared collection.** The Pokémon the user owns (species, IVs, level, label) live in one list for every format.
- **Everything else is per format:** the chosen team of three, the battle in progress, and the Builder's priorities. Switching formats never touches another format's state.
- **A format's Pokémon are the ones PvPoke ranks in it.** In Fantasy the Team tab and the Builder only show collection Pokémon ranked in Fantasy; the rest are hidden, not deleted. Search (Team tab add, Battle opponent) only offers the format's ranked species.
- **Moves always come from the format.** Every Pokémon, the user's and the opponent's, uses that format's PvPoke ranking moveset. A collection Pokémon the format doesn't rank keeps its stored moves (only reachable in Great League through an import).
- **The Builder scores against the format's meta**: the top 150 it can simulate (Fantasy ranks 197, 195 simulatable).

## Non-goals

- Picking non-standard moves. The user accepted losing the Team tab's move pickers.
- Other cups or leagues. Adding one later should be one entry in the format list plus its rankings file.
- Type-based eligibility rules. PvPoke's rankings already are the eligible list.

## Data

- `npm run update-data` also vendors `rankings/fantasy/overall/rankings-1500.json` as `data/rankings-fantasy-1500.json`.
- PvPoke data moves to commit `415436c` (2026-10-20), the first with Great League Fantasy rankings. Oracle fixtures and the matrix are regenerated; the engine still matches PvPoke on every case. The matrix and oracle tooling stay open-Great-League only.
- `app-data.json` carries one rankings list per format: `formats: [{ id, title, rankings }]`.

## Saved state

`SavedApp` goes to version 2: `{ roster, format, byFormat: { [id]: { team, battle, priorities } } }`. A version-1 save loads as Great League with its team, battle and priorities; Fantasy starts empty. Team indices stay indices into the shared roster; deleting a roster entry remaps every format's team.

## Builder's calls (not discussed, change if wrong)

- Format list lives in one place (`src/companion/formats.ts`); ids `great` and `fantasy`.
- The worker keeps one simulation cache and meta per format.
- Team tab: the move pickers become read-only text naming the format's moves; a line says how many collection Pokémon are hidden as not in this format.
