# Elemental

A mobile-friendly, client-side PWA for playtesting **Elemental**, a quick face-up set-collection game for 2–4 players. The current rules are in [elemental_rulebook.md](./elemental_rulebook.md). [elemental_sim.py](./elemental_sim.py) is the companion balance simulation.

## Run locally

Serve the project directory over HTTP (service workers do not work from `file://`):

```sh
python3 -m http.server 4173
```

Then open [http://localhost:4173](http://localhost:4173). The app has no build step or runtime dependencies. Games save automatically in browser storage, and the app shell is cached for offline use.

## Digital playtest

- Choose 2, 3, or 4 total players. You play against the remaining AI opponents.
- All hands are face-up. On your turn, draw one card, then cast one card as its spell or discard one card.
- Tap a card in your hand to read its spell, then choose **Cast Spell** or **Discard Spell (Draw 1)**. Either action ends your turn.
- Fire opponents choose their own discard to protect their largest set. If an AI casts Fire, you choose which of your cards to discard.
- To cast Air, select an Air card, choose **Cast Spell**, then click a card in an opponent's hand to take it.
- The game ends immediately when a player has 7 cards of one element.
- Open **?** for the in-game rules. Use **New game** to reset the match.
