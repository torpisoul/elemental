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
- All hands are face-up. On your turn, draw one card, then play one card; spells have effects, while Mana does not. **Allow “Discard 1, Draw 1”** starts disabled for testing and controls whether discarding and replacing a card is available in both simulations and manual games.
- The game table places you at the bottom, with opponents around the table. Spell instructions sit in a readable, element-tinted box on every card; a full-size face-down draw deck sits beside the discard pile. Drawn cards turn face-up on the deck before flying to a hand, and played cards arc from a hand into the discard pile.
- Permanent starting balance is in [game-config.mjs](./game-config.mjs). Change that file to adjust the deck, win target, spell effects, or discard-and-draw default. Increase `version` there when you change the balance so existing browser settings reload the new defaults.
- Current permanent defaults: 5 Mana cards to win; 42-card deck (7 each of Fire, Earth, Water, and Air, plus 14 Mana); Fire draws 1, then makes each opponent discard 2; Earth draws 2; Water recovers 1; Air steals 1. Mana has no spell effect. Other spells do not draw replacement cards, and discard-and-draw is disabled.
- Tap a card to cast it immediately. For Air, tap the opponent card you want to steal. If **Discard 1, Draw 1** is enabled, use its action toggle before tapping a card to discard instead.
- Use the **Simulation lab** (∑) to run up to 100,000 AI-only matches per setup (the default). Results aggregate across all completed matches. Adjust player count, deck composition, win target, match count, maximum rounds, random seed, AI action style, and whether discard-and-draw is available. You can also compare the action enabled and disabled with the same seed. The discard-and-draw toggle also controls that action in manual games.
- Edit the **Adjustable spell rules** in the lab to try different effects without editing code: Fire discards per opponent, Earth draws, Water recoveries, Air steals, a global draw after any spell, and additional replacement draws for each spell. Values range from 0 to 10; the global and per-spell replacement draws add together. Rule edits are saved locally and apply immediately to manual games as well as simulations. Restore the default spell rules at any time.
- Simulation strategies are spell-first, off-set discard-first, or random legal action. Results report Mana win rates, game length, spell rates, and use of discard-and-draw.
- Comparisons use the same seed and per-match starting deck order. The three AI strategies are simplified models for testing action policies, not predictions of human play.
- Fire opponents choose their discards to protect their largest set. If an AI casts Fire, select all the cards you must discard; they are discarded together.
- To play Air, tap an Air card, then tap a card in another player's hand to take it. The stolen card flies to your hand.
- The game ends immediately when a player has 5 Mana cards.
- Open **?** for the in-game rules. Use **New game** to reset the match.
