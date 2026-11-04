# AI Agent Instructions: Elemental Altars PWA Development

## 1. Project Overview & Product Vision
* **Project Name:** Elemental Altars
* **Format:** Progressive Web App (PWA) — Mobile-first, responsive single-page web app.
* **Player Count:** 5 Players total (1 Human Player vs. 4 AI Opponents).
* **Match Tempo:** High-strategy, predictable match length averaging ~10 turns (5–10 minutes per match).
* **Tech Stack:** Vanilla JavaScript (ES6+), HTML5, and CSS3 packaged via Vite or runnable as a standalone static bundle. Zero backend required (fully client-side state).

---

## 2. Mathematical Balancing & Simulation Methodology
The game economy is calibrated via Monte Carlo simulations (100,000+ test runs) to achieve razor-sharp win parity and mechanical balance:
* **Match Duration:** ~10.1 turns average.
* **Win Parity:** ~50:50 split between Hoarder and Collector victory paths.
* **Discard Pile Start:** Completely empty (`0` cards initially). Graveyard builds organically through mandatory Mana fuel sacrifices.
* **Fuel Economy:** Casting spells requires sacrificing Mana cards from hand as fuel, preventing spam and feeding the Water graveyard-reclamation loop.

---

## 3. Deck Structure & Win Conditions

### A. Deck Composition (100 Cards Total)
* **60 Mana Cards:**
  * Value `1`: 10 cards
  * Value `2`: 10 cards
  * Value `3`: 10 cards
  * Value `4`: 10 cards
  * Value `5`: 8 cards
  * Value `6`: 6 cards
  * Value `7`: 6 cards
* **40 Spell Cards (10 per Element):**
  * 🔥 Fire (10 cards)
  * 🌿 Earth (10 cards)
  * 💧 Water (10 cards)
  * ⚡ Air (10 cards)

### B. Dual Win Conditions (Instant Check at Turn End)
A player wins immediately if their Vault meets either condition:
1. **Hoarder Path:** **46+ Total Points** in Vault.
2. **Collector Path:** **10+ Total Cards** in Vault (regardless of individual point values).

---

## 4. Turn State Machine Architecture
Every player's turn must follow this exact 4-step sequential pipeline: