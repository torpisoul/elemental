# Elemental

A mobile-friendly, client-side PWA for playtesting **Elemental**, a quick face-up set-collection game for 2–4 players. The current rules are in [elemental_rulebook.md](./elemental_rulebook.md). The **Simulation lab** runs configurable AI matches in the browser; [elemental_sim.py](./elemental_sim.py) remains as the original offline balance simulation.

## Run locally

Serve the project directory over HTTP (service workers do not work from `file://`):

```sh
python3 -m http.server 4173
```

Then open [http://localhost:4173](http://localhost:4173). The app has no build step or runtime dependencies. Games save automatically in browser storage, and the app shell is cached for offline use.

## Digital playtest

- Choose 2, 3, or 4 total players. You play against the remaining AI opponents.
- All hands are face-up. On your turn, draw one card, then take one action. **Allow “Discard 1, Draw 1”** starts disabled for testing and controls whether discarding and replacing a card is available in both simulations and manual games; when disabled, cast one card as a spell.
- Permanent starting balance is in [game-config.mjs](./game-config.mjs). Change that file to adjust the deck, win target, spell effects, or discard-and-draw default. Increase `version` there when you change the balance so existing browser settings reload the new defaults.
- Current permanent defaults: 5-card win target; 39-card deck (9 Fire, 9 Earth, 11 Water, 10 Air); Fire makes each opponent discard 2 and draws 1 after casting; Earth draws 2; Water recovers 1; Air steals 1. Other spells do not draw replacement cards, and discard-and-draw is disabled.
- Tap a card in your hand to read its spell, then choose **Cast Spell** or, when enabled, **Discard Spell (Draw 1)**. Either action ends your turn.
- Use the **Simulation lab** (∑) to run up to 100,000 AI-only matches per setup (the default). Results aggregate across all completed matches. Adjust player count, deck composition, win target, match count, maximum rounds, random seed, AI action style, and whether discard-and-draw is available. You can also compare the action enabled and disabled with the same seed. The discard-and-draw toggle also controls that action in manual games.
- Edit the **Adjustable spell rules** in the lab to try different effects without editing code: Fire discards per opponent, Earth draws, Water recoveries, Air steals, a global draw after any spell, and additional replacement draws for each spell. Values range from 0 to 10; the global and per-spell replacement draws add together. Rule edits are saved locally and apply immediately to manual games as well as simulations. Restore the default spell rules at any time.
- Simulation strategies are spell-first, off-set discard-first, or random legal action. Results report win rates, game length, winning elements, spell rates, and use of discard-and-draw.
- Comparisons use the same seed and per-match starting deck order. The three AI strategies are simplified models for testing action policies, not predictions of human play.
- Fire opponents choose their own discard to protect their largest set. If an AI casts Fire, you choose which of your cards to discard.
- To cast Air, select an Air card, choose **Cast Spell**, then click a card in an opponent's hand to take it.
- The game ends immediately when a player has 5 cards of one element.
- Open **?** for the in-game rules. Use **New game** to reset the match.
