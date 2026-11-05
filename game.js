import { GAME_CONFIG } from "./game-config.mjs";
import { DEFAULT_SIMULATION_SETTINGS, DEFAULT_SPELL_RULES, runSimulation } from "./simulation.mjs";

const ELEMENTS = {
  fire: {
    label: "Fire",
    icon: "🔥",
    className: "fire",
  },
  earth: {
    label: "Earth",
    icon: "🌿",
    className: "earth",
  },
  air: {
    label: "Air",
    icon: "⚡",
    className: "air",
  },
  water: {
    label: "Water",
    icon: "💧",
    className: "water",
  },
};
const ELEMENT_ORDER = Object.keys(ELEMENTS);
const PLAYER_NAMES = ["You", "Ash", "Bramble", "Zephyr"];
const SAVE_KEY = "elemental-game-save-v2";
const SIMULATION_SETTINGS_KEY = "elemental-simulation-settings-v3";
const LEGACY_SIMULATION_SETTINGS_KEYS = ["elemental-simulation-settings-v2", "elemental-simulation-settings-v1"];

const $ = (selector) => document.querySelector(selector);
const welcomeScreen = $("#welcome-screen");
const gameScreen = $("#game-screen");
const controlsElement = $("#action-controls");
function loadSimulationSettings() {
  try {
    const currentSaved = localStorage.getItem(SIMULATION_SETTINGS_KEY);
    const saved = currentSaved ?? LEGACY_SIMULATION_SETTINGS_KEYS
      .map((key) => localStorage.getItem(key))
      .find((value) => value !== null);
    if (!saved) return { ...DEFAULT_SIMULATION_SETTINGS, deck: { ...DEFAULT_SIMULATION_SETTINGS.deck } };
    const parsed = JSON.parse(saved);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Saved simulation settings must be an object.");
    }
    const usesCurrentBalance = currentSaved && parsed.balanceVersion === GAME_CONFIG.version;
    const settings = {
      ...DEFAULT_SIMULATION_SETTINGS,
      ...parsed,
      balanceVersion: GAME_CONFIG.version,
      allowDiscardDraw: usesCurrentBalance ? parsed.allowDiscardDraw : DEFAULT_SIMULATION_SETTINGS.allowDiscardDraw,
      target: usesCurrentBalance ? parsed.target : DEFAULT_SIMULATION_SETTINGS.target,
      deck: {
        ...DEFAULT_SIMULATION_SETTINGS.deck,
        ...(usesCurrentBalance && parsed.deck && typeof parsed.deck === "object" && !Array.isArray(parsed.deck)
          ? parsed.deck
          : {}),
      },
      rules: {
        ...DEFAULT_SPELL_RULES,
        ...(usesCurrentBalance && parsed.rules && typeof parsed.rules === "object" && !Array.isArray(parsed.rules)
          ? parsed.rules
          : {}),
        drawAfterSpell: {
          ...DEFAULT_SPELL_RULES.drawAfterSpell,
          ...(usesCurrentBalance && parsed.rules?.drawAfterSpell && typeof parsed.rules.drawAfterSpell === "object" &&
            !Array.isArray(parsed.rules.drawAfterSpell) ? parsed.rules.drawAfterSpell : {}),
        },
      },
    };
    const deckTotal = Object.values(settings.deck).reduce((sum, count) => sum + count, 0);
    if (!Number.isInteger(settings.matches) || settings.matches < 1 || settings.matches > 100000 ||
        !Number.isInteger(settings.players) || settings.players < 2 || settings.players > 4 ||
        !Number.isInteger(settings.target) || settings.target < 2 || settings.target > deckTotal ||
        !Number.isInteger(settings.maxRounds) || settings.maxRounds < 1 || settings.maxRounds > 5000 ||
        !Number.isInteger(settings.seed) || settings.seed < 0 || settings.seed > 4294967295 ||
        !["spell-first", "discard-first", "random"].includes(settings.strategy) ||
        typeof settings.allowDiscardDraw !== "boolean" ||
        Object.keys(settings.deck).some((element) => !Object.hasOwn(DEFAULT_SIMULATION_SETTINGS.deck, element)) ||
        Object.values(settings.deck).some((count) => !Number.isInteger(count) || count < 0 || count > 1000) ||
        Object.keys(settings.rules).some((rule) => !Object.hasOwn(DEFAULT_SPELL_RULES, rule)) ||
        Object.keys(settings.rules.drawAfterSpell).some((element) => !ELEMENT_ORDER.includes(element)) ||
        Object.values(settings.rules.drawAfterSpell).some((count) => !Number.isInteger(count) || count < 0 || count > 10) ||
        [settings.rules.drawAfterAnySpell, settings.rules.fireDiscardsPerOpponent, settings.rules.earthDraws,
          settings.rules.waterRecovers, settings.rules.airSteals]
          .some((count) => !Number.isInteger(count) || count < 0 || count > 10) ||
        deckTotal < settings.players * 3) {
      throw new Error("Saved simulation settings are outside the supported ranges.");
    }
    return settings;
  } catch (error) {
    console.error("Could not load simulation settings.", error);
    return { ...DEFAULT_SIMULATION_SETTINGS, deck: { ...DEFAULT_SIMULATION_SETTINGS.deck } };
  }
}

let simulationSettings = loadSimulationSettings();
let game = null;
let selectedCardId = null;
let targetingAir = false;
let aiTimer = null;
let discardDrawEnabled = simulationSettings.allowDiscardDraw;

function spellDescription(element) {
  const { rules } = simulationSettings;
  const descriptions = {
    fire: rules.fireDiscardsPerOpponent
      ? `Every opponent, starting with the next player, chooses ${rules.fireDiscardsPerOpponent} card${rules.fireDiscardsPerOpponent === 2 ? "" : "s"} from their hand to discard.`
      : "Fire has no discard effect.",
    earth: `Draw ${rules.earthDraws} card${rules.earthDraws === 2 ? "" : "s"} from the deck.`,
    water: rules.waterRecovers
      ? `Take up to ${rules.waterRecovers} top card${rules.waterRecovers === 1 ? "" : "s"} from the discard pile. The Water card you played is then placed on top.`
      : "Water does not recover cards from the discard pile. The Water card you played is placed on top.",
    air: rules.airSteals
      ? `Choose an opponent and take up to ${rules.airSteals} card${rules.airSteals === 1 ? "" : "s"} of one element from their hand.`
      : "Air has no steal effect.",
  };
  const extraDraws = rules.drawAfterAnySpell + rules.drawAfterSpell[element];
  return `${descriptions[element]}${extraDraws ? ` Then draw ${extraDraws} replacement card${extraDraws === 1 ? "" : "s"}.` : ""}`;
}

function updateSpellReference() {
  for (const element of ELEMENT_ORDER) {
    const description = $(`#rules-${element}-description`);
    if (description) description.textContent = spellDescription(element);
  }
  $("#win-rule-description").textContent =
    `On your turn, draw 1 card. If you now have ${simulationSettings.target} of one element, you win immediately.`;
  $("#rules-win-footnote").textContent =
    `First player with ${simulationSettings.target} cards of the same element wins. In this digital playtest, AI opponents choose their own Fire discard; when an AI targets you with Fire, you choose your card.`;
}

function createDeck() {
  return shuffle(Object.entries(simulationSettings.deck).flatMap(([element, count]) =>
    Array.from({ length: count }, () => ({ id: crypto.randomUUID(), element })),
  ));
}

function shuffle(cards) {
  const shuffled = [...cards];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  return shuffled;
}

function createPlayer(index) {
  return {
    id: `player-${index}`,
    name: PLAYER_NAMES[index],
    isHuman: index === 0,
    hand: [],
  };
}

function newGame(playerCount = Number($("#player-count").value)) {
  window.clearTimeout(aiTimer);
  const players = Array.from({ length: playerCount }, (_, index) => createPlayer(index));
  game = {
    players,
    deck: createDeck(),
    discard: [],
    currentPlayer: 0,
    turn: 1,
    phase: "draw",
    pendingFireQueue: null,
    pendingHumanDiscard: null,
    pendingFireCasterId: null,
    winner: null,
    log: [],
    activity: [],
  };
  selectedCardId = null;
  targetingAir = false;
  for (let deal = 0; deal < 3; deal += 1) {
    for (const player of players) drawOne(player);
  }
  addActivity(`A ${playerCount}-player game begins. Everyone receives 3 face-up cards.`, "✦", "setup");
  startTurn(0);
}

function drawOne(player) {
  if (game.deck.length === 0 && game.discard.length > 0) {
    game.deck = shuffle(game.discard);
    game.discard = [];
    addActivity("The discard pile was shuffled to make a new draw pile.", "↻", "shuffle");
  }
  const card = game.deck.pop();
  if (!card) return null;
  player.hand.push(card);
  return card;
}

function elementCounts(player) {
  return Object.fromEntries(ELEMENT_ORDER.map((element) => [
    element,
    player.hand.filter((card) => card.element === element).length,
  ]));
}

function dominantElement(player) {
  const counts = elementCounts(player);
  return ELEMENT_ORDER.reduce((best, element) => counts[element] > counts[best] ? element : best, ELEMENT_ORDER[0]);
}

function winningElement(player) {
  return ELEMENT_ORDER.find((element) => player.hand.filter((card) => card.element === element).length >= simulationSettings.target) ?? null;
}

function checkForWinner(player) {
  const element = winningElement(player);
  if (!element) return false;
  game.winner = { playerId: player.id, playerName: player.name, element };
  game.phase = "game-over";
  game.pendingFireQueue = null;
  game.pendingHumanDiscard = null;
  game.pendingFireCasterId = null;
  addActivity(`${player.name} collected ${simulationSettings.target} ${ELEMENTS[element].label} cards and wins!`, ELEMENTS[element].icon, "win");
  saveGame();
  render();
  showResult();
  return true;
}

function addActivity(message, symbol = "✦", type = "action") {
  if (!game) return;
  game.log.unshift(message);
  game.log = game.log.slice(0, 60);
  game.activity.unshift({ id: crypto.randomUUID(), message, symbol, type });
  game.activity = game.activity.slice(0, 8);
}

function startTurn(playerIndex) {
  if (game.winner) return;
  game.currentPlayer = playerIndex;
  game.phase = "draw";
  const player = game.players[playerIndex];
  const drawn = drawOne(player);
  addActivity(drawn
    ? `${player.name} drew 1 card.`
    : `${player.name} could not draw because both piles are empty.`,
  drawn ? ELEMENTS[drawn.element].icon : "—", "draw");
  if (checkForWinner(player)) return;
  game.phase = "action";
  selectedCardId = null;
  saveGame();
  render();
  if (!player.isHuman) scheduleAI();
}

function finishTurn() {
  if (game.winner) return;
  const nextPlayer = (game.currentPlayer + 1) % game.players.length;
  if (nextPlayer === 0) game.turn += 1;
  selectedCardId = null;
  startTurn(nextPlayer);
}

function removeFromHand(player, cardId) {
  const index = player.hand.findIndex((card) => card.id === cardId);
  return index < 0 ? null : player.hand.splice(index, 1)[0];
}

function discardCard(player, cardId, reason = "discarded") {
  const card = removeFromHand(player, cardId);
  if (!card) return false;
  game.discard.push(card);
  addActivity(`${player.name} ${reason} ${ELEMENTS[card.element].label}.`, ELEMENTS[card.element].icon, "discard");
  return true;
}

function opponentsInTurnOrder(playerIndex) {
  return Array.from({ length: game.players.length - 1 }, (_, offset) =>
    (playerIndex + offset + 1) % game.players.length,
  );
}

function castSpell(caster, cardId, targetPlayerIndex = null, targetCardId = null) {
  const spellInHand = caster.hand.find((card) => card.id === cardId);
  if (!spellInHand) return false;
  if (spellInHand.element === "air" && simulationSettings.rules.airSteals > 0 &&
      (targetPlayerIndex !== null || targetCardId !== null)) {
    const target = game.players[targetPlayerIndex];
    if (!target || target === caster || !target.hand.some((card) => card.id === targetCardId)) return false;
  }
  const spell = removeFromHand(caster, cardId);
  const element = spell.element;
  addActivity(`${caster.name} cast ${ELEMENTS[element].label}.`, ELEMENTS[element].icon, "spell");

  if (element === "water") {
    game.discard.push(spell);
    let recoveredCount = 0;
    for (let recovery = 0; recovery < simulationSettings.rules.waterRecovers && game.discard.length > 1; recovery += 1) {
      const recovered = game.discard.splice(game.discard.length - 2, 1)[0];
      caster.hand.push(recovered);
      recoveredCount += 1;
      addActivity(`${caster.name} took ${ELEMENTS[recovered.element].label} from the top of the discard pile.`, ELEMENTS[recovered.element].icon, "water");
      if (checkForWinner(caster)) return true;
    }
    if (!recoveredCount) {
      addActivity("Water recovered no cards from the discard pile.", ELEMENTS.water.icon, "water");
    }
  } else {
    game.discard.push(spell);
    if (element === "earth") {
      for (let draw = 0; draw < simulationSettings.rules.earthDraws; draw += 1) {
        const card = drawOne(caster);
        if (!card) break;
        addActivity(`${caster.name} drew ${ELEMENTS[card.element].label} with Earth.`, ELEMENTS.earth.icon, "earth");
        if (checkForWinner(caster)) return true;
      }
    } else if (element === "air") {
      if (simulationSettings.rules.airSteals > 0) {
        const target = game.players[targetPlayerIndex];
        const firstCard = target?.hand.find((card) => card.id === targetCardId);
        if (target && firstCard) {
          for (let steal = 0; steal < simulationSettings.rules.airSteals; steal += 1) {
            const stolen = steal === 0
              ? removeFromHand(target, targetCardId)
              : removeFromHand(target, target.hand.find((card) => card.element === firstCard.element)?.id);
            if (!stolen) break;
            caster.hand.push(stolen);
            addActivity(`${caster.name} took ${ELEMENTS[stolen.element].label} from ${target.name}.`, ELEMENTS.air.icon, "air");
            if (checkForWinner(caster)) return true;
          }
        } else {
          addActivity("Air found no card to steal.", ELEMENTS.air.icon, "air");
        }
      } else {
        addActivity("Air has no steal effect.", ELEMENTS.air.icon, "air");
      }
    } else if (element === "fire") {
      game.pendingFireQueue = Array.from({ length: simulationSettings.rules.fireDiscardsPerOpponent }, () =>
        opponentsInTurnOrder(game.currentPlayer)).flat();
      game.pendingFireCasterId = caster.id;
      game.phase = "fire-discard";
      processFireQueue();
      return true;
    }
  }

  if (drawSpellReplacements(caster, element)) return true;
  finishTurn();
  return true;
}

function drawSpellReplacements(player, element) {
  const count = simulationSettings.rules.drawAfterAnySpell + simulationSettings.rules.drawAfterSpell[element];
  for (let draw = 0; draw < count; draw += 1) {
    const card = drawOne(player);
    if (!card) break;
    addActivity(`${player.name} drew ${ELEMENTS[card.element].label} to replace their ${ELEMENTS[element].label} spell.`, ELEMENTS[element].icon, "draw");
    if (checkForWinner(player)) return true;
  }
  return false;
}

function chooseAIDiscard(player) {
  const target = dominantElement(player);
  return player.hand.find((card) => card.element !== target) ?? player.hand[0] ?? null;
}

function processFireQueue() {
  while (game.pendingFireQueue?.length && !game.winner) {
    const targetIndex = game.pendingFireQueue.shift();
    const target = game.players[targetIndex];
    if (!target.hand.length) continue;

    if (target.isHuman) {
      game.pendingHumanDiscard = target.id;
      game.phase = "defend";
      saveGame();
      render();
      return;
    }

    const card = chooseAIDiscard(target);
    discardCard(target, card.id, "discarded");
  }

  game.pendingFireQueue = null;
  game.pendingHumanDiscard = null;
  const caster = game.players.find((player) => player.id === game.pendingFireCasterId);
  game.pendingFireCasterId = null;
  if (!game.winner && caster && drawSpellReplacements(caster, "fire")) return;
  if (!game.winner) finishTurn();
}

function chooseAIAction(player) {
  if (!player.hand.length) return { type: "pass" };
  const targetElement = dominantElement(player);
  const water = player.hand.find((card) => card.element === "water");
  if (water && game.discard.at(-1)?.element === targetElement) {
    return { type: "cast", card: water };
  }
  const spell = player.hand.find((card) => card.element !== targetElement);
  if (spell) return { type: "cast", card: spell };
  if (discardDrawEnabled) return { type: "discard", card: chooseAIDiscard(player) };
  return { type: "cast", card: player.hand[0] };
}

function runAITurn() {
  if (game.winner || game.phase !== "action" || game.players[game.currentPlayer].isHuman) return;
  const player = game.players[game.currentPlayer];
  const action = chooseAIAction(player);
  if (action.type === "pass") {
    finishTurn();
    return;
  }
  if (action.type === "discard") {
    discardCard(player, action.card.id);
    const drawn = drawOne(player);
    if (drawn) {
      addActivity(`${player.name} drew 1 card after discarding.`, ELEMENTS[drawn.element].icon, "draw");
      if (checkForWinner(player)) return;
    }
    finishTurn();
    return;
  }

  if (action.card.element === "air" && simulationSettings.rules.airSteals > 0) {
    const needed = dominantElement(player);
    const targetIndex = opponentsInTurnOrder(game.currentPlayer).find((index) =>
      game.players[index].hand.some((card) => card.element === needed),
    );
    const target = targetIndex === undefined ? null : game.players[targetIndex];
    const stolen = target?.hand.find((card) => card.element === needed);
    if (target && stolen) castSpell(player, action.card.id, targetIndex, stolen.id);
    else castSpell(player, action.card.id);
    return;
  }
  castSpell(player, action.card.id);
}

function scheduleAI() {
  window.clearTimeout(aiTimer);
  aiTimer = window.setTimeout(() => {
    if (!game || game.winner || game.phase !== "action" || game.players[game.currentPlayer].isHuman) return;
    runAITurn();
    saveGame();
    render();
  }, 450);
}

function selectHumanCard(cardId) {
  if (game.phase === "defend" && game.pendingHumanDiscard === game.players[0].id) {
    if (!discardCard(game.players[0], cardId, "chose to discard")) return;
    game.pendingHumanDiscard = null;
    processFireQueue();
    saveGame();
    render();
    return;
  }
  if (game.phase !== "action" || game.currentPlayer !== 0) return;
  selectedCardId = selectedCardId === cardId ? null : cardId;
  targetingAir = false;
  render();
}

function humanCastSelected(targetPlayerIndex = null, targetCardId = null) {
  if (game.phase !== "action" || game.currentPlayer !== 0) return;
  const spell = game.players[0].hand.find((card) => card.id === selectedCardId);
  if (!spell) return;
  if (spell.element === "air" && simulationSettings.rules.airSteals > 0 &&
      (targetPlayerIndex === null || !targetCardId)) {
    targetingAir = true;
    render();
    return;
  }
  selectedCardId = null;
  targetingAir = false;
  castSpell(game.players[0], spell.id, targetPlayerIndex, targetCardId);
  saveGame();
  render();
}

function discardAndDrawSelected() {
  if (!discardDrawEnabled || game.phase !== "action" || game.currentPlayer !== 0 || !selectedCardId) return;
  const player = game.players[0];
  if (!discardCard(player, selectedCardId)) return;
  selectedCardId = null;
  targetingAir = false;
  const drawn = drawOne(player);
  if (drawn) {
    addActivity(`You drew ${ELEMENTS[drawn.element].label} after discarding.`, ELEMENTS[drawn.element].icon, "draw");
    if (checkForWinner(player)) return;
  } else {
    addActivity("You could not draw a replacement because both piles are empty.", "—", "draw");
  }
  saveGame();
  finishTurn();
  saveGame();
  render();
}

function showResult() {
  const winner = game?.winner;
  if (!winner) return;
  $("#result-eyebrow").textContent = winner.playerId === "player-0" ? "YOU WIN!" : "GAME OVER";
  $("#result-title").textContent = winner.playerId === "player-0" ? "Elemental!" : `${winner.playerName} wins!`;
  $("#result-copy").textContent =
    `${winner.playerName} collected ${simulationSettings.target} ${ELEMENTS[winner.element].label} cards.`;
  const dialog = $("#result-dialog");
  if (!dialog.open) dialog.showModal();
}

function makeCard(card, options = {}) {
  const data = ELEMENTS[card.element];
  const cardElement = document.createElement("span");
  cardElement.className = `playing-card element-${data.className}${options.selected ? " selected" : ""}`;
  cardElement.setAttribute("aria-hidden", "true");
  cardElement.innerHTML = `<span class="card-icon">${data.icon}</span><span>${data.label}</span>`;
  return cardElement;
}

function renderHand(player, { human = false, defending = false, opponentIndex = -1 } = {}) {
  const hand = document.createElement("div");
  hand.className = `face-up-hand${human ? " human-hand" : ""}`;
  hand.setAttribute("aria-label", `${player.name}'s face-up hand`);

  for (const element of ELEMENT_ORDER) {
    const elementCards = player.hand.filter((card) => card.element === element);
    if (!elementCards.length) continue;
    const selected = human && elementCards.some((card) => card.id === selectedCardId);
    const isAirTarget = !human && targetingAir;
    const canChoose = human
      ? defending || game.currentPlayer === 0 && game.phase === "action"
      : isAirTarget;
    const stack = document.createElement(canChoose ? "button" : "div");
    stack.className = `hand-stack element-${ELEMENTS[element].className}${selected ? " selected" : ""}`;
    if (canChoose) {
      stack.type = "button";
      stack.addEventListener("click", () => {
        if (defending) {
          selectHumanCard(elementCards[0].id);
        } else if (human) {
          selectHumanCard(elementCards[0].id);
        } else {
          humanCastSelected(opponentIndex, elementCards[0].id);
        }
      });
    }
    stack.setAttribute(
      "aria-label",
      defending
        ? `Discard ${ELEMENTS[element].label}`
        : isAirTarget
          ? `Take ${ELEMENTS[element].label} from ${player.name}`
          : `${ELEMENTS[element].label} card${elementCards.length === 1 ? "" : "s"}`,
    );
    stack.style.setProperty("--stack-size", String(elementCards.length));
    stack.append(...elementCards.map((card) => makeCard(card, { selected })));
    hand.append(stack);
  }
  return hand;
}

function renderPlayers() {
  const container = $("#players");
  container.classList.toggle("targeting-air", targetingAir);
  const opponents = game.players.slice(1).map((player, offset) => {
    const index = offset + 1;
    const card = document.createElement("article");
    const active = index === game.currentPlayer && !game.winner;
    card.className = `player-board opponent-board${active ? " active" : ""}`;
    const heading = document.createElement("div");
    heading.className = "player-heading";
    const name = document.createElement("strong");
    name.textContent = player.name;
    const status = document.createElement("span");
    status.className = "player-status";
    status.textContent = active ? "PLAYING" : "";
    heading.append(name, status);
    card.append(heading, renderHand(player, { opponentIndex: index }));
    return card;
  });
  container.replaceChildren(...opponents);

  const human = game.players[0];
  const humanHandBoard = $("#human-hand-board");
  const defending = game.phase === "defend" && game.pendingHumanDiscard === human.id;
  humanHandBoard.classList.toggle("defending", defending);
  $("#human-status").textContent = defending ? "CHOOSE A CARD" : "YOUR HAND";
  const humanHand = $("#human-hand");
  humanHand.classList.toggle("defending-hand", defending);
  humanHand.setAttribute("aria-label", "Your face-up hand");
  humanHand.replaceChildren(...renderHand(human, { human, defending }).childNodes);
}

function renderActions() {
  controlsElement.replaceChildren();
  const card = game.players[0].hand.find((item) => item.id === selectedCardId);
  const spellTip = $("#spell-tip");
  const spellTipTitle = $("#spell-tip-title");
  const spellTipText = $("#spell-tip-text");
  const addButton = (label, action, secondary = false) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `action-button${secondary ? " secondary" : ""}`;
    button.textContent = label;
    button.addEventListener("click", action);
    controlsElement.append(button);
  };

  $("#step-number").textContent = "YOUR ACTION";
  $("#action-description").textContent = "";
  if (game.winner) {
    $("#step-number").textContent = "GAME OVER";
    spellTip.className = "spell-tip";
    spellTipTitle.textContent = "The game has ended";
    spellTipText.textContent = "Start a new game to play again.";
    spellTip.setAttribute("aria-label", "The game has ended. Start a new game to play again.");
    return;
  }
  if (game.phase === "defend") {
    const humanIndex = game.players.findIndex((player) => player.id === game.pendingHumanDiscard);
    const fireDiscardsRemaining = 1 + (game.pendingFireQueue ?? []).filter((index) => index === humanIndex).length;
    $("#step-number").textContent = "FIRE!";
    spellTip.className = "spell-tip element-fire";
    spellTipTitle.textContent = "🔥 Fire: choose a card to discard";
    spellTipText.textContent = `An opponent cast Fire. Tap a card in your hand to discard it. ${fireDiscardsRemaining} discard${fireDiscardsRemaining === 1 ? "" : "s"} remain for you.`;
    spellTip.setAttribute("aria-label", `Fire: choose a card to discard. ${fireDiscardsRemaining} discard${fireDiscardsRemaining === 1 ? "" : "s"} remain for you.`);
    return;
  }
  if (game.currentPlayer !== 0) {
    $("#step-number").textContent = "OPPONENT TURN";
    spellTip.className = "spell-tip";
    spellTipTitle.textContent = "The AI is choosing an action";
    spellTipText.textContent = "Your turn begins after the other players have played.";
    spellTip.setAttribute("aria-label", "Opponent turn. The AI is choosing an action.");
    return;
  }

  if (!card) {
    spellTip.className = "spell-tip";
    spellTipTitle.textContent = "Your action";
    spellTipText.textContent = "Select a card in your hand to see its spell and choose what to do.";
    const hasCards = game.players[0].hand.length > 0;
    $("#action-description").textContent = hasCards ? "Your hand is shown below." : "You have no cards to play.";
    spellTip.setAttribute("aria-label", hasCards
      ? "Your action. Select a card in your hand to see its spell and choose what to do."
      : "Your action. You have no cards to play. End your turn.");
    if (!hasCards) addButton("End turn", finishTurn);
    return;
  }

  const spell = ELEMENTS[card.element];
  spellTip.className = `spell-tip element-${spell.className}`;
  spellTipTitle.textContent = `${spell.icon} ${spell.label} spell`;
  spellTipText.textContent = targetingAir && spell.className === "air"
    ? `Choose a card from an opponent's hand above to steal up to ${simulationSettings.rules.airSteals} of that element.`
    : spellDescription(card.element);
  spellTip.setAttribute("aria-label", `${spell.label} spell: ${spellTipText.textContent}`);
  $("#action-description").textContent = "";

  if (targetingAir && spell.className === "air") {
    addButton("Cancel", () => {
      targetingAir = false;
      render();
    }, true);
    return;
  }
  addButton("Cast Spell", () => humanCastSelected());
  if (discardDrawEnabled) addButton("Discard Spell (Draw 1)", discardAndDrawSelected, true);
}

function renderActivity() {
  const list = $("#activity-list");
  list.replaceChildren(...game.activity.slice(0, 3).map((action) => {
    const item = document.createElement("li");
    const icon = document.createElement("span");
    icon.textContent = action.symbol;
    const message = document.createElement("span");
    message.textContent = action.message;
    item.append(icon, message);
    return item;
  }));
}

function render() {
  document.body.classList.toggle("in-game", Boolean(game));
  $("#welcome-copy").textContent =
    `Collect ${simulationSettings.target} cards of one element in your face-up hand to win. Cast a spell to help your set or disrupt the other players.`;
  $("#discard-rule-description").textContent = discardDrawEnabled
    ? "Otherwise, take exactly one action: cast one card as its spell, or discard one card and draw a replacement."
    : "Otherwise, cast one card from your hand as its spell.";
  updateSpellReference();
  if (!game) {
    welcomeScreen.classList.remove("hidden");
    gameScreen.classList.add("hidden");
    return;
  }
  welcomeScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  $("#turn-label").textContent = `ROUND ${game.turn} · ${game.players.length} PLAYERS`;
  $("#phase-title").textContent = game.winner
    ? `${game.winner.playerName} wins with ${ELEMENTS[game.winner.element].label}.`
    : game.phase === "defend"
      ? "Defend against Fire"
      : game.currentPlayer === 0
        ? "Your turn"
        : `${game.players[game.currentPlayer].name} is playing`;
  $("#deck-count").textContent = String(game.deck.length);
  $("#discard-count").textContent = String(game.discard.length);
  $("#round-count").textContent = String(game.turn);
  $("#discard-pile").classList.toggle("has-cards", game.discard.length > 0);
  const top = game.discard.at(-1);
  const topCard = $("#discard-top-card");
  topCard.className = top ? `top-card element-${ELEMENTS[top.element].className}` : "top-card empty";
  topCard.textContent = top ? `${ELEMENTS[top.element].icon} ${ELEMENTS[top.element].label}` : "Empty";
  renderPlayers();
  renderActions();
  renderActivity();
  $("#log-count").textContent = String(game.log.length);
  $("#log-list").replaceChildren(...game.log.map((entry) => {
    const item = document.createElement("li");
    item.textContent = entry;
    return item;
  }));
}

function saveGame() {
  if (!game) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(game));
  } catch (error) {
    console.error("Could not save Elemental game.", error);
    $("#save-note").textContent = "Auto-save is unavailable in this browser session.";
  }
}

function loadGame() {
  try {
    const saved = localStorage.getItem(SAVE_KEY);
    if (!saved) return false;
    const parsed = JSON.parse(saved);
    if (!parsed || !Array.isArray(parsed.players) || parsed.players.length < 2 || parsed.players.length > 4 ||
        !Array.isArray(parsed.deck) || !Array.isArray(parsed.discard) || !Number.isInteger(parsed.currentPlayer) ||
        parsed.currentPlayer < 0 || parsed.currentPlayer >= parsed.players.length ||
        !["draw", "action", "fire-discard", "defend", "game-over"].includes(parsed.phase) ||
        parsed.players.some((player) => !Array.isArray(player.hand))) {
      throw new Error("Saved game has an invalid shape.");
    }
    game = parsed;
    game.activity ??= [];
    game.log ??= [];
    selectedCardId = null;
    render();
    if (!game.winner && game.phase !== "defend" && !game.players[game.currentPlayer].isHuman) scheduleAI();
    return true;
  } catch (error) {
    console.error("Could not load Elemental game save.", error);
    localStorage.removeItem(SAVE_KEY);
    return false;
  }
}

function populateSimulationForm(settings) {
  $("#sim-matches").value = settings.matches;
  $("#sim-players").value = settings.players;
  $("#sim-target").value = settings.target;
  $("#sim-max-rounds").value = settings.maxRounds;
  $("#sim-seed").value = settings.seed;
  $("#sim-strategy").value = settings.strategy;
  $("#sim-discard-draw").checked = settings.allowDiscardDraw;
  for (const [element, count] of Object.entries(settings.deck)) {
    $(`#sim-${element}`).value = count;
  }
  $("#sim-rule-global-draw").value = settings.rules.drawAfterAnySpell;
  $("#sim-rule-fire-discard").value = settings.rules.fireDiscardsPerOpponent;
  $("#sim-rule-earth-draw").value = settings.rules.earthDraws;
  $("#sim-rule-water-recover").value = settings.rules.waterRecovers;
  $("#sim-rule-air-steal").value = settings.rules.airSteals;
  for (const element of ELEMENT_ORDER) {
    $(`#sim-rule-${element}-replace`).value = settings.rules.drawAfterSpell[element];
  }
  updateSimulationTargetLimit();
}

function updateSimulationTargetLimit() {
  const deckTotal = ["fire", "earth", "water", "air"].reduce(
    (sum, element) => sum + Number($(`#sim-${element}`).value || 0),
    0,
  );
  $("#sim-target").max = String(Math.max(2, deckTotal));
}

function readSimulationForm() {
  return {
    balanceVersion: GAME_CONFIG.version,
    matches: Number($("#sim-matches").value),
    players: Number($("#sim-players").value),
    target: Number($("#sim-target").value),
    maxRounds: Number($("#sim-max-rounds").value),
    seed: Number($("#sim-seed").value),
    strategy: $("#sim-strategy").value,
    allowDiscardDraw: $("#sim-discard-draw").checked,
    deck: {
      fire: Number($("#sim-fire").value),
      earth: Number($("#sim-earth").value),
      water: Number($("#sim-water").value),
      air: Number($("#sim-air").value),
    },
    rules: readSpellRulesForm(),
  };
}

function readSpellRulesForm() {
  return {
    drawAfterAnySpell: Number($("#sim-rule-global-draw").value),
    drawAfterSpell: Object.fromEntries(ELEMENT_ORDER.map((element) => [
      element,
      Number($(`#sim-rule-${element}-replace`).value),
    ])),
    fireDiscardsPerOpponent: Number($("#sim-rule-fire-discard").value),
    earthDraws: Number($("#sim-rule-earth-draw").value),
    waterRecovers: Number($("#sim-rule-water-recover").value),
    airSteals: Number($("#sim-rule-air-steal").value),
  };
}

function syncSpellRules() {
  const inputs = [...$(".simulation-rules").querySelectorAll("input")];
  if (inputs.some((input) => !input.checkValidity())) return;
  simulationSettings = { ...simulationSettings, rules: readSpellRulesForm() };
  if (!persistSimulationSettings(simulationSettings)) {
    $("#simulation-status").textContent = "Spell rules could not be saved on this device.";
  }
  updateSpellReference();
  render();
}

function resetSpellRules() {
  const defaults = DEFAULT_SPELL_RULES;
  $("#sim-rule-global-draw").value = defaults.drawAfterAnySpell;
  $("#sim-rule-fire-discard").value = defaults.fireDiscardsPerOpponent;
  $("#sim-rule-earth-draw").value = defaults.earthDraws;
  $("#sim-rule-water-recover").value = defaults.waterRecovers;
  $("#sim-rule-air-steal").value = defaults.airSteals;
  for (const element of ELEMENT_ORDER) {
    $(`#sim-rule-${element}-replace`).value = defaults.drawAfterSpell[element];
  }
  syncSpellRules();
}

function persistSimulationSettings(settings) {
  simulationSettings = settings;
  discardDrawEnabled = settings.allowDiscardDraw;
  try {
    localStorage.setItem(SIMULATION_SETTINGS_KEY, JSON.stringify({
      ...settings,
      balanceVersion: GAME_CONFIG.version,
    }));
    return true;
  } catch (error) {
    console.error("Could not save simulation settings.", error);
    return false;
  }
}

function appendMetric(list, label, value) {
  const entry = document.createElement("div");
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = value;
  entry.append(term, description);
  list.append(entry);
}

function renderSimulationResult(summary, title, settings) {
  const section = document.createElement("section");
  section.className = "simulation-result";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const context = document.createElement("p");
  context.className = "simulation-context";
  const { rules } = settings;
  const replacementDraws = `${rules.drawAfterAnySpell} after every spell; extras Fire ${rules.drawAfterSpell.fire}, Earth ${rules.drawAfterSpell.earth}, Water ${rules.drawAfterSpell.water}, Air ${rules.drawAfterSpell.air}`;
  context.textContent = `${summary.players} players · target ${settings.target} · ${summary.strategy.replaceAll("-", " ")} · cap ${settings.maxRounds} rounds · Fire ${rules.fireDiscardsPerOpponent}/opponent · Earth ${rules.earthDraws} draw · Water ${rules.waterRecovers} recover · Air ${rules.airSteals} steal · spell draws ${replacementDraws}`;
  const metrics = document.createElement("dl");
  metrics.className = "simulation-metrics";
  appendMetric(metrics, "Matches", summary.completed.toLocaleString());
  appendMetric(metrics, "Wins", `${summary.wins.toLocaleString()} (${(summary.winRate * 100).toFixed(1)}%)`);
  appendMetric(metrics, "Round cap reached", summary.unresolved.toLocaleString());
  appendMetric(metrics, "Avg. rounds to win", summary.wins ? summary.averageRoundsToWin.toFixed(1) : "—");
  appendMetric(metrics, "Avg. rounds per match", summary.averageObservedRounds.toFixed(1));
  appendMetric(metrics, "Avg. discard/draw actions", summary.averageDiscardDraws.toFixed(2));
  appendMetric(metrics, "Avg. winner hand size", summary.averageWinnerHandSize.toFixed(2));

  const table = document.createElement("table");
  table.className = "simulation-table";
  const head = document.createElement("thead");
  const headerRow = document.createElement("tr");
  for (const label of ["Element", "Wins", "Win share", "Winner casts", "Casts / match"]) {
    const cell = document.createElement("th");
    cell.textContent = label;
    headerRow.append(cell);
  }
  head.append(headerRow);
  const body = document.createElement("tbody");
  for (const [element, icon, label] of [
    ["fire", "🔥", "Fire"],
    ["earth", "🌿", "Earth"],
    ["water", "💧", "Water"],
    ["air", "⚡", "Air"],
  ]) {
    const row = document.createElement("tr");
    const values = [
      `${icon} ${label}`,
      summary.winningElements[element].toLocaleString(),
      summary.wins ? `${(summary.winningElements[element] / summary.wins * 100).toFixed(1)}%` : "—",
      summary.averageWinnerSpells[element].toFixed(2),
      summary.averageSpellsPerMatch[element].toFixed(2),
    ];
    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    body.append(row);
  }
  table.append(head, body);
  section.append(heading, context, metrics, table);
  return section;
}

async function runSimulationTask(compare = false) {
  const form = $("#simulation-form");
  const errorMessage = $("#simulation-error");
  errorMessage.classList.add("hidden");
  errorMessage.textContent = "";
  updateSimulationTargetLimit();
  if (!form.reportValidity()) return;

  const settings = readSimulationForm();
  const runButton = $("#run-simulation-button");
  const compareButton = $("#compare-simulation-button");
  const status = $("#simulation-status");
  const results = $("#simulation-results");
  results.replaceChildren();
  runButton.disabled = true;
  compareButton.disabled = true;

  try {
    if (compare) {
      for (const allowDiscardDraw of [false, true]) {
        const variant = { ...settings, allowDiscardDraw };
        const label = allowDiscardDraw ? "Discard 1, Draw 1 available" : "Discard 1, Draw 1 unavailable";
        status.textContent = `${label}: 0 / ${settings.matches.toLocaleString()} matches`;
        const summary = await runSimulation(variant, ({ completed, total }) => {
          status.textContent = `${label}: ${completed.toLocaleString()} / ${total.toLocaleString()} matches`;
        });
        results.append(renderSimulationResult(summary, label, settings));
      }
      status.textContent = `Comparison complete · same seed ${settings.seed}`;
    } else {
      status.textContent = `Running ${settings.matches.toLocaleString()} matches…`;
      const summary = await runSimulation(settings, ({ completed, total }) => {
        status.textContent = `Running ${completed.toLocaleString()} / ${total.toLocaleString()} matches…`;
      });
      results.append(renderSimulationResult(
        summary,
        settings.allowDiscardDraw ? "Discard 1, Draw 1 available" : "Discard 1, Draw 1 unavailable",
        settings,
      ));
      status.textContent = `Simulation complete · seed ${settings.seed}`;
    }
    const saved = persistSimulationSettings(settings);
    if (!saved) {
      status.textContent += " · Settings could not be saved on this device.";
    }
    render();
  } catch (error) {
    console.error("Simulation failed.", error);
    errorMessage.textContent = error instanceof Error ? error.message : "The simulation failed.";
    errorMessage.classList.remove("hidden");
    status.textContent = "Simulation did not complete.";
  } finally {
    runButton.disabled = false;
    compareButton.disabled = false;
  }
}

populateSimulationForm(simulationSettings);
$("#simulation-button").addEventListener("click", () => $("#simulation-dialog").showModal());
$(".close-simulation-dialog").addEventListener("click", () => $("#simulation-dialog").close());
$("#simulation-dialog").addEventListener("click", (event) => {
  if (event.target === $("#simulation-dialog")) $("#simulation-dialog").close();
});
$("#sim-discard-draw").addEventListener("change", () => {
  simulationSettings = { ...simulationSettings, allowDiscardDraw: $("#sim-discard-draw").checked };
  if (!persistSimulationSettings(simulationSettings)) {
    $("#simulation-status").textContent = "Settings could not be saved on this device.";
  }
  render();
});
$(".simulation-deck").addEventListener("input", updateSimulationTargetLimit);
$(".simulation-rules").addEventListener("input", syncSpellRules);
$("#reset-spell-rules").addEventListener("click", resetSpellRules);
$("#run-simulation-button").addEventListener("click", () => runSimulationTask());
$("#compare-simulation-button").addEventListener("click", () => runSimulationTask(true));

$("#start-button").addEventListener("click", () => newGame());
$("#new-game-button").addEventListener("click", () => newGame());
$("#log-button").addEventListener("click", () => $("#log-dialog").showModal());
$(".close-log-dialog").addEventListener("click", () => $("#log-dialog").close());
$("#play-again-button").addEventListener("click", () => {
  $("#result-dialog").close();
  newGame();
});
$("#rules-button").addEventListener("click", () => $("#rules-dialog").showModal());
$(".close-dialog").addEventListener("click", () => $("#rules-dialog").close());
$("#rules-dialog").addEventListener("click", (event) => {
  if (event.target === $("#rules-dialog")) $("#rules-dialog").close();
});

render();
loadGame();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.error("Service worker registration failed.", error);
    });
  });
}
