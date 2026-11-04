# Elemental Altars

A mobile-first, client-side PWA playtest for **Elemental Altars**. One human player competes against four AI opponents. The deck, turn flow, spell effects, and win conditions follow [the rulebook](./elemental_altars_rulebook.md), with the low-Mana redraw playtest variant noted below.

## Run locally

Serve the project directory over HTTP (service workers do not work from `file://`):

```sh
python3 -m http.server 4173
```

Then open [http://localhost:4173](http://localhost:4173). The app has no build step or external runtime dependencies. Once loaded, its app shell is cached for offline use, and the current game is saved in the browser's local storage.

## Playtest controls

- Clicking a Mana card stages it automatically.
- At the start of a turn, a hand with fewer than 2 Mana is discarded and redrawn to 5 once; the replacement hand is kept even if it is still low. The game log tracks this separately for you and the AI opponents.
- Optionally select a Spell and 1 or 2 Mana fuel cards. For Basic Fire and all Air spells, click the chosen opponent's name to target them; this casts the selected basic or enhanced version. For Water, select 1 or 2 Mana cards in the discard pile and use the Basic or Enhanced button to reclaim them to your Altar. Other spells use the Basic or Enhanced action buttons. Casting a spell animates its effect and ends your turn automatically.
- The table-action strip reports the latest actions and highlights opponent spell effects, including shield blocks.
- Choose **Skip spell & end turn** to finish without casting.
- Open **?** for the in-game spell reference. Use **New game** to reset the current playtest.
- The game log tracks turns where your hand has Spells but no fuel left after staging, so you can monitor how often that play pattern occurs.
