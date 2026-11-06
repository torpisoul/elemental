// Permanent balance defaults. Adjust these values to change new games and simulations.
export const GAME_CONFIG = {
  version: 3,
  deck: { fire: 7, earth: 7, water: 7, air: 7, mana: 14 },
  target: 5,
  allowDiscardDraw: false,
  spells: {
    drawAfterAnySpell: 0,
    drawAfterSpell: { fire: 1, earth: 0, water: 1, air: 0 },
    fireDiscardsPerOpponent: 1,
    earthDraws: 2,
    waterRecovers: 1,
    airSteals: 1,
  },
};
