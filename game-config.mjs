// Permanent balance defaults. Adjust these values to change new games and simulations.
export const GAME_CONFIG = {
  version: 2,
  deck: { fire: 9, earth: 9, water: 11, air: 10 },
  target: 5,
  allowDiscardDraw: false,
  spells: {
    drawAfterAnySpell: 0,
    drawAfterSpell: { fire: 1, earth: 0, water: 0, air: 0 },
    fireDiscardsPerOpponent: 2,
    earthDraws: 2,
    waterRecovers: 1,
    airSteals: 1,
  },
};
