import random
import pandas as pd

# =====================================================================
# ⚙️ GAME CONFIGURATION (DEFENDER-CHOICE FIRE LOGIC)
# =====================================================================
ELEMENTS = ['FIRE', 'EARTH', 'WATER', 'AIR']
DECK_COMPOSITION = {
    'FIRE': 9,
    'EARTH': 10,
    'WATER': 11,
    'AIR': 10
}
TARGET_MATCHING_CARDS = 7  # Win condition: Collect 7 of 1 single element
MAX_HAND_SIZE = 100

class Card:
    def __init__(self, element):
        self.element = element

def create_deck():
    cards = []
    for elem, count in DECK_COMPOSITION.items():
        cards.extend([Card(elem) for _ in range(count)])
    random.shuffle(cards)
    return cards

class Player:
    def __init__(self, pid, name):
        self.pid = pid
        self.name = name
        self.hand = []
        self.spells_cast = {'FIRE': 0, 'EARTH': 0, 'WATER': 0, 'AIR': 0}
        self.trashed_count = 0

    def element_counts(self):
        counts = {elem: 0 for elem in ELEMENTS}
        for card in self.hand:
            counts[card.element] += 1
        return counts

    def highest_element_count(self):
        counts = self.element_counts()
        return max(counts.values()) if counts else 0

    def target_element(self):
        counts = self.element_counts()
        return max(counts, key=counts.get)

# =====================================================================
# 🎮 SIMULATION ENGINE
# =====================================================================
class KidGameSim:
    def __init__(self, num_players=4):
        self.deck = create_deck()
        self.discard = []
        self.players = [
            Player(0, "Arlan (Player)"),
            Player(1, "Bot 1"),
            Player(2, "Bot 2"),
            Player(3, "Bot 3")
        ][:num_players]
        self.turn_count = 0
        self.winner = None
        self.winning_element = None

        # Initial deal: 3 cards each
        for p in self.players:
            for _ in range(3):
                c = self.draw_card()
                if c: p.hand.append(c)

    def draw_card(self):
        if not self.deck:
            if not self.discard:
                return None
            self.deck = self.discard[:]
            self.discard = []
            random.shuffle(self.deck)
        return self.deck.pop() if self.deck else None

    def play_game(self, max_turns=500):
        while self.turn_count < max_turns:
            for p in self.players:
                self.take_turn(p)

                if p.highest_element_count() >= TARGET_MATCHING_CARDS:
                    self.winner = p
                    self.winning_element = p.target_element()
                    return

            self.turn_count += 1

    def take_turn(self, player):
        # 1. MANDATORY DRAW 1
        drawn = self.draw_card()
        if drawn:
            player.hand.append(drawn)

        if player.highest_element_count() >= TARGET_MATCHING_CARDS:
            return

        # 2. PLAY 1 SPELL OR TRASH 1 CARD
        target_elem = player.target_element()
        opponents = [o for o in self.players if o.pid != player.pid]

        spell_card = None

        # Smart Water Check
        water_cards = [c for c in player.hand if c.element == 'WATER']
        if water_cards and self.discard and self.discard[-1].element == target_elem:
            spell_card = water_cards[0]
        else:
            playable_spells = [c for c in player.hand if c.element != target_elem]
            if playable_spells:
                spell_card = playable_spells[0]

        if spell_card:
            player.hand.remove(spell_card)
            player.spells_cast[spell_card.element] += 1
            self.resolve_spell(player, spell_card, opponents)

        elif len(player.hand) > MAX_HAND_SIZE:
            counts = player.element_counts()
            least_elem = min(counts, key=counts.get)
            trash_candidates = [c for c in player.hand if c.element == least_elem]
            if trash_candidates:
                to_trash = trash_candidates[0]
                player.hand.remove(to_trash)
                self.discard.append(to_trash)
                player.trashed_count += 1

    def resolve_spell(self, caster, spell_card, opponents):
        element = spell_card.element

        # 1. WATER: Retrieve visible top card from discard BEFORE played card lands
        if element == 'WATER':
            if self.discard:
                claimed = self.discard.pop()
                caster.hand.append(claimed)

        # 2. Played spell goes to discard
        self.discard.append(spell_card)

        # 3. OTHER SPELLS
        if element == 'FIRE':
            # FIRE ALL: Impacted player chooses which card to discard
            for opp in opponents:
                if opp.hand:
                    opp_target = opp.target_element()
                    # Defender choice: prefer discarding an off-target card
                    off_target_cards = [c for c in opp.hand if c.element != opp_target]
                    if off_target_cards:
                        card_to_burn = off_target_cards[0]
                    else:
                        card_to_burn = opp.hand[0] # Forced to drop a target card if hand is 100% target

                    opp.hand.remove(card_to_burn)
                    self.discard.append(card_to_burn)

        elif element == 'EARTH':
            # EARTH: DRAW 2 CARDS FROM DECK
            for _ in range(2):
                c = self.draw_card()
                if c:
                    caster.hand.append(c)

        elif element == 'AIR':
            # AIR: Steal 1 needed card from an opponent
            target_elem = caster.target_element()
            for opp in opponents:
                matching_in_opp = [c for c in opp.hand if c.element == target_elem]
                if matching_in_opp:
                    stolen = matching_in_opp[0]
                    opp.hand.remove(stolen)
                    caster.hand.append(stolen)
                    break

# =====================================================================
# 📊 SIMULATION RUNNER
# =====================================================================
if __name__ == "__main__":
    num_matches = 100000
    print(f"Running {num_matches:,} matches for Defender-Choice Fire Logic...")

    results = []
    for _ in range(num_matches):
        sim = KidGameSim(num_players=4)
        sim.play_game()
        if sim.winner:
            w = sim.winner
            counts = w.element_counts()
            target_elem = sim.winning_element
            other_cards_count = sum(v for k, v in counts.items() if k != target_elem)

            results.append({
                'winner': w.name,
                'winning_element': target_elem,
                'turns': sim.turn_count,
                'fire_casts': w.spells_cast['FIRE'],
                'earth_casts': w.spells_cast['EARTH'],
                'water_casts': w.spells_cast['WATER'],
                'air_casts': w.spells_cast['AIR'],
                'total_hand_size': len(w.hand),
                'winning_set_size': counts[target_elem],
                'off_element_cards': other_cards_count
            })

    df = pd.DataFrame(results)

    print("\n" + "="*65)
    print("📊 DEFENDER-CHOICE FIRE SIMULATION REPORT")
    print("="*65)
    print(f"• Win Condition:             First to {TARGET_MATCHING_CARDS} of 1 Element")
    print(f"• Average Match Duration:    {df['turns'].mean():.2f} rounds (~{df['turns'].mean() * 4:.1f} total turns)")
    print(f"\n• Winning Element Balance:\n{df['winning_element'].value_counts(normalize=True) * 100}\n")
    print("• AVERAGE SPELLS CAST BY WINNER PER GAME:")
    print(f"   🔥 Fire (All): {df['fire_casts'].mean():.2f}")
    print(f"   🌿 Earth:      {df['earth_casts'].mean():.2f}")
    print(f"   💧 Water:      {df['water_casts'].mean():.2f}")
    print(f"   ⚡ Air:        {df['air_casts'].mean():.2f}")
    print("="*65 + "\n")
