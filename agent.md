# Elemental PWA Notes

## Current game

The current rules are defined in [elemental_rulebook.md](./elemental_rulebook.md). The PWA supports 2–4 total players: one human and up to three AI opponents. All hands are face-up, and the first player to hold 7 cards of one element wins.

## Implementation

- `game.js` contains the game state, 40-card deck, turn flow, AI decisions, spell resolution, local save/load, and rendering.
- `index.html` contains the game table and the in-app quick rules.
- `styles.css` defines the responsive layout and element card styles.
- `service-worker.js` caches the static app shell. Bump `CACHE_NAME` whenever the deployed app changes.
- `elemental_sim.py` is the companion balance simulation; it is not part of the browser runtime.

The app is dependency-free and can be served locally with `python3 -m http.server 4173`.
