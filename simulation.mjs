import { GAME_CONFIG } from "./game-config.mjs";

export const SIMULATION_ELEMENTS = ["fire", "earth", "water", "air"];
export const DEFAULT_DECK_COUNTS = { ...GAME_CONFIG.deck };
export const DEFAULT_SPELL_RULES = {
  ...GAME_CONFIG.spells,
  drawAfterSpell: { ...GAME_CONFIG.spells.drawAfterSpell },
};
export const DEFAULT_SIMULATION_SETTINGS = {
  matches: 100000,
  players: 4,
  target: GAME_CONFIG.target,
  maxRounds: 500,
  seed: 1,
  allowDiscardDraw: GAME_CONFIG.allowDiscardDraw,
  strategy: "spell-first",
  deck: { ...DEFAULT_DECK_COUNTS },
  rules: {
    ...DEFAULT_SPELL_RULES,
    drawAfterSpell: { ...DEFAULT_SPELL_RULES.drawAfterSpell },
  },
};

function randomGenerator(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function shuffle(cards, random) {
  const shuffled = [...cards];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  return shuffled;
}

function elementCounts(player) {
  return Object.fromEntries(SIMULATION_ELEMENTS.map((element) => [
    element,
    player.hand.filter((card) => card.element === element).length,
  ]));
}

function dominantElement(player) {
  const counts = elementCounts(player);
  return SIMULATION_ELEMENTS.reduce(
    (best, element) => counts[element] > counts[best] ? element : best,
    SIMULATION_ELEMENTS[0],
  );
}

function leastValuableCardIndex(player) {
  const counts = elementCounts(player);
  let selectedIndex = 0;
  for (let index = 1; index < player.hand.length; index += 1) {
    if (counts[player.hand[index].element] < counts[player.hand[selectedIndex].element]) {
      selectedIndex = index;
    }
  }
  return selectedIndex;
}

function validateSettings(settings) {
  const deckTotal = SIMULATION_ELEMENTS.reduce((sum, element) => sum + settings.deck[element], 0);
  if (!Number.isInteger(settings.matches) || settings.matches < 1 || settings.matches > 100000) {
    throw new RangeError("Matches must be an integer between 1 and 100,000.");
  }
  if (!Number.isInteger(settings.players) || settings.players < 2 || settings.players > 4) {
    throw new RangeError("Players must be between 2 and 4.");
  }
  if (!Number.isInteger(settings.maxRounds) || settings.maxRounds < 1 || settings.maxRounds > 5000) {
    throw new RangeError("Maximum rounds must be between 1 and 5,000.");
  }
  if (!Number.isInteger(settings.seed) || settings.seed < 0 || settings.seed > 4294967295) {
    throw new RangeError("Seed must be an integer between 0 and 4,294,967,295.");
  }
  if (!["spell-first", "discard-first", "random"].includes(settings.strategy)) {
    throw new RangeError("Choose a supported AI strategy.");
  }
  const ruleValues = [
    settings.rules.drawAfterAnySpell,
    ...SIMULATION_ELEMENTS.map((element) => settings.rules.drawAfterSpell[element]),
    settings.rules.fireDiscardsPerOpponent,
    settings.rules.earthDraws,
    settings.rules.waterRecovers,
    settings.rules.airSteals,
  ];
  if (ruleValues.some((value) => !Number.isInteger(value) || value < 0 || value > 10)) {
    throw new RangeError("Spell rules must use whole numbers from 0 to 10.");
  }
  if (Object.keys(settings.rules).some((rule) => !Object.hasOwn(DEFAULT_SPELL_RULES, rule)) ||
      Object.keys(settings.rules.drawAfterSpell).some((element) => !SIMULATION_ELEMENTS.includes(element))) {
    throw new RangeError("Choose supported spell rule settings.");
  }
  for (const element of SIMULATION_ELEMENTS) {
    if (!Number.isInteger(settings.deck[element]) || settings.deck[element] < 0 || settings.deck[element] > 1000) {
      throw new RangeError(`The ${element} deck count must be an integer from 0 to 1,000.`);
    }
  }
  if (deckTotal < settings.players * 3) {
    throw new RangeError("The deck needs at least 3 starting cards per player.");
  }
  if (!Number.isInteger(settings.target) || settings.target < 2 || settings.target > deckTotal) {
    throw new RangeError(`The win target must be from 2 to the ${deckTotal} cards in the deck.`);
  }
}

function simulateMatch(settings, random) {
  let deck = shuffle(
    SIMULATION_ELEMENTS.flatMap((element) =>
      Array.from({ length: settings.deck[element] }, () => ({ element })),
    ),
    random,
  );
  const discard = [];
  const players = Array.from({ length: settings.players }, (_, index) => ({
    name: index === 0 ? "Player 1" : `Bot ${index}`,
    hand: [],
    spells: Object.fromEntries(SIMULATION_ELEMENTS.map((element) => [element, 0])),
    discardDraws: 0,
  }));
  let reshuffles = 0;

  const drawCard = (player) => {
    if (!deck.length && discard.length) {
      deck = shuffle(discard, random);
      discard.length = 0;
      reshuffles += 1;
    }
    const card = deck.pop() ?? null;
    if (card) player.hand.push(card);
    return card;
  };

  const winnerElement = (player) => {
    const counts = elementCounts(player);
    return SIMULATION_ELEMENTS.find((element) => counts[element] >= settings.target) ?? null;
  };

  const makeResult = (player, element, turns, won) => ({
    winner: won ? player : null,
    element: won ? element : null,
    turns,
    rounds: Math.ceil(turns / settings.players),
    handSize: won ? player.hand.length : 0,
    winningSetSize: won ? elementCounts(player)[element] : 0,
    spells: player.spells,
    discardDraws: players.reduce((sum, participant) => sum + participant.discardDraws, 0),
    spellTotals: Object.fromEntries(SIMULATION_ELEMENTS.map((spell) => [
      spell,
      players.reduce((sum, participant) => sum + participant.spells[spell], 0),
    ])),
    reshuffles,
  });

  for (let deal = 0; deal < 3; deal += 1) {
    for (const player of players) drawCard(player);
  }

  for (let turn = 0; turn < settings.maxRounds * settings.players; turn += 1) {
    const currentIndex = turn % settings.players;
    const player = players[currentIndex];
    const turns = turn + 1;
    drawCard(player);
    const afterDraw = winnerElement(player);
    if (afterDraw) return makeResult(player, afterDraw, turns, true);
    if (!player.hand.length) continue;

    const target = dominantElement(player);
    const smartWaterIndex = player.hand.findIndex((card) =>
      card.element === "water" && discard.at(-1)?.element === target,
    );
    const offTargetIndex = player.hand.findIndex((card) => card.element !== target);
    const leastValuableIndex = leastValuableCardIndex(player);
    let action;

    if (settings.strategy === "random") {
      action = settings.allowDiscardDraw && random() < 0.5 ? "discard" : "cast";
    } else if (settings.strategy === "discard-first" && settings.allowDiscardDraw && offTargetIndex >= 0) {
      action = "discard";
    } else if (smartWaterIndex >= 0 || offTargetIndex >= 0) {
      action = "cast";
    } else if (settings.allowDiscardDraw && settings.strategy === "spell-first") {
      action = "discard";
    } else {
      action = "cast";
    }

    if (action === "discard") {
      let cardIndex = leastValuableIndex;
      if (settings.strategy === "random") cardIndex = Math.floor(random() * player.hand.length);
      const [discarded] = player.hand.splice(cardIndex, 1);
      discard.push(discarded);
      player.discardDraws += 1;
      drawCard(player);
      const afterReplacement = winnerElement(player);
      if (afterReplacement) return makeResult(player, afterReplacement, turns, true);
      continue;
    }

    let spellIndex = smartWaterIndex >= 0 ? smartWaterIndex : offTargetIndex;
    if (settings.strategy === "random") spellIndex = Math.floor(random() * player.hand.length);
    if (spellIndex < 0) spellIndex = leastValuableIndex;
    const [spell] = player.hand.splice(spellIndex, 1);
    player.spells[spell.element] += 1;
    discard.push(spell);

    const replacementDraws = settings.rules.drawAfterAnySpell + settings.rules.drawAfterSpell[spell.element];
    if (spell.element === "fire") {
      for (let draw = 0; draw < replacementDraws; draw += 1) {
        drawCard(player);
        const replacementWin = winnerElement(player);
        if (replacementWin) return makeResult(player, replacementWin, turns, true);
      }
    }

    if (spell.element === "water") {
      for (let recovery = 0; recovery < settings.rules.waterRecovers && discard.length > 1; recovery += 1) {
        player.hand.push(discard.splice(discard.length - 2, 1)[0]);
        const recoveredWin = winnerElement(player);
        if (recoveredWin) return makeResult(player, recoveredWin, turns, true);
      }
    } else if (spell.element === "earth") {
      for (let draw = 0; draw < settings.rules.earthDraws; draw += 1) {
        drawCard(player);
        const earthWin = winnerElement(player);
        if (earthWin) return makeResult(player, earthWin, turns, true);
      }
    } else if (spell.element === "air") {
      const neededElement = dominantElement(player);
      for (let offset = 1; offset < settings.players; offset += 1) {
        const targetPlayer = players[(currentIndex + offset) % settings.players];
        if (!targetPlayer.hand.some((card) => card.element === neededElement)) continue;
        for (let steal = 0; steal < settings.rules.airSteals; steal += 1) {
          const stolenIndex = targetPlayer.hand.findIndex((card) => card.element === neededElement);
          if (stolenIndex < 0) break;
          player.hand.push(targetPlayer.hand.splice(stolenIndex, 1)[0]);
          const airWin = winnerElement(player);
          if (airWin) return makeResult(player, airWin, turns, true);
        }
        break;
      }
    } else if (spell.element === "fire") {
      for (let burn = 0; burn < settings.rules.fireDiscardsPerOpponent; burn += 1) {
        for (let offset = 1; offset < settings.players; offset += 1) {
          const targetPlayer = players[(currentIndex + offset) % settings.players];
          if (!targetPlayer.hand.length) continue;
          const targetElement = dominantElement(targetPlayer);
          const discardIndex = targetPlayer.hand.findIndex((card) => card.element !== targetElement);
          const [burned] = targetPlayer.hand.splice(discardIndex < 0 ? 0 : discardIndex, 1);
          discard.push(burned);
        }
      }
    }

    if (spell.element !== "fire") {
      for (let draw = 0; draw < replacementDraws; draw += 1) {
        drawCard(player);
        const replacementWin = winnerElement(player);
        if (replacementWin) return makeResult(player, replacementWin, turns, true);
      }
    }

    const afterSpell = winnerElement(player);
    if (afterSpell) return makeResult(player, afterSpell, turns, true);
  }

  const noWinner = {
    winner: null,
    element: null,
    turns: settings.maxRounds * settings.players,
    rounds: settings.maxRounds,
    handSize: 0,
    winningSetSize: 0,
    spells: Object.fromEntries(SIMULATION_ELEMENTS.map((element) => [element, 0])),
    discardDraws: players.reduce((sum, participant) => sum + participant.discardDraws, 0),
    spellTotals: Object.fromEntries(SIMULATION_ELEMENTS.map((element) => [
      element,
      players.reduce((sum, participant) => sum + participant.spells[element], 0),
    ])),
    reshuffles,
  };
  return noWinner;
}

function createSummary(settings) {
  return {
    matches: settings.matches,
    players: settings.players,
    allowDiscardDraw: settings.allowDiscardDraw,
    strategy: settings.strategy,
    completed: 0,
    wins: 0,
    unresolved: 0,
    totalRounds: 0,
    totalWinningRounds: 0,
    totalTurns: 0,
    totalWinnerHandSize: 0,
    totalWinningSetSize: 0,
    totalDiscardDraws: 0,
    totalReshuffles: 0,
    winningElements: Object.fromEntries(SIMULATION_ELEMENTS.map((element) => [element, 0])),
    winnerSpells: Object.fromEntries(SIMULATION_ELEMENTS.map((element) => [element, 0])),
    totalSpells: Object.fromEntries(SIMULATION_ELEMENTS.map((element) => [element, 0])),
  };
}

export async function runSimulation(settings, onProgress = () => {}) {
  settings = {
    ...settings,
    rules: {
      ...DEFAULT_SPELL_RULES,
      ...settings.rules,
      drawAfterSpell: {
        ...DEFAULT_SPELL_RULES.drawAfterSpell,
        ...settings.rules?.drawAfterSpell,
      },
    },
  };
  validateSettings(settings);
  const summary = createSummary(settings);
  const batchSize = Math.max(1, Math.min(250, Math.floor(settings.matches / 100) || 1));

  for (let index = 0; index < settings.matches; index += 1) {
    const matchSeed = (settings.seed + Math.imul(index, 0x9e3779b1)) >>> 0;
    const result = simulateMatch(settings, randomGenerator(matchSeed));
    summary.completed += 1;
    summary.totalRounds += result.rounds;
    summary.totalTurns += result.turns;
    summary.totalDiscardDraws += result.discardDraws;
    summary.totalReshuffles += result.reshuffles;
    for (const element of SIMULATION_ELEMENTS) summary.totalSpells[element] += result.spellTotals[element];
    if (result.winner) {
      summary.wins += 1;
      summary.totalWinningRounds += result.rounds;
      summary.winningElements[result.element] += 1;
      summary.totalWinnerHandSize += result.handSize;
      summary.totalWinningSetSize += result.winningSetSize;
      for (const element of SIMULATION_ELEMENTS) summary.winnerSpells[element] += result.spells[element];
    } else {
      summary.unresolved += 1;
    }

    if (summary.completed % batchSize === 0 || summary.completed === settings.matches) {
      onProgress({ completed: summary.completed, total: settings.matches });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const wins = summary.wins || 1;
  summary.averageRoundsToWin = summary.totalWinningRounds / wins;
  summary.averageObservedRounds = summary.totalRounds / summary.completed;
  summary.averageTurns = summary.totalTurns / summary.completed;
  summary.averageDiscardDraws = summary.totalDiscardDraws / summary.completed;
  summary.averageWinnerHandSize = summary.totalWinnerHandSize / wins;
  summary.averageWinningSetSize = summary.totalWinningSetSize / wins;
  summary.averageWinnerSpells = Object.fromEntries(SIMULATION_ELEMENTS.map((element) => [
    element,
    summary.winnerSpells[element] / wins,
  ]));
  summary.averageSpellsPerMatch = Object.fromEntries(SIMULATION_ELEMENTS.map((element) => [
    element,
    summary.totalSpells[element] / summary.completed,
  ]));
  summary.winRate = summary.wins / summary.completed;
  return summary;
}
