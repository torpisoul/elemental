const ELEMENTS = {
  fire: {
    label: "Fire",
    icon: "🔥",
    className: "fire",
    description: "Every opponent, starting with the next player, chooses one card from their own hand to discard.",
  },
  earth: {
    label: "Earth",
    icon: "🌿",
    className: "earth",
    description: "Draw 2 cards from the deck into your hand.",
  },
  air: {
    label: "Air",
    icon: "⚡",
    className: "air",
    description: "Choose an opponent and take one card from their face-up hand.",
  },
  water: {
    label: "Water",
    icon: "💧",
    className: "water",
    description: "Take the top card of the discard pile into your hand. The Water card you played then becomes the new top discard.",
  },
};
const ELEMENT_ORDER = Object.keys(ELEMENTS);
const DECK_COUNTS = { fire: 9, earth: 10, water: 11, air: 10 };
const PLAYER_NAMES = ["You", "Ash", "Bramble", "Zephyr"];
const SAVE_KEY = "elemental-game-save-v2";

const $ = (selector) => document.querySelector(selector);
const welcomeScreen = $("#welcome-screen");
const gameScreen = $("#game-screen");
const controlsElement = $("#action-controls");
let game = null;
let selectedCardId = null;
let targetingAir = false;
let aiTimer = null;

function createDeck() {
  return shuffle(Object.entries(DECK_COUNTS).flatMap(([element, count]) =>
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
  return ELEMENT_ORDER.find((element) => player.hand.filter((card) => card.element === element).length >= 7) ?? null;
}

function checkForWinner(player) {
  const element = winningElement(player);
  if (!element) return false;
  game.winner = { playerId: player.id, playerName: player.name, element };
  game.phase = "game-over";
  game.pendingFireQueue = null;
  game.pendingHumanDiscard = null;
  addActivity(`${player.name} collected 7 ${ELEMENTS[element].label} cards and wins!`, ELEMENTS[element].icon, "win");
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
  if (spellInHand.element === "air") {
    const target = game.players[targetPlayerIndex];
    if (!target || target === caster || !target.hand.some((card) => card.id === targetCardId)) return false;
  }
  const spell = removeFromHand(caster, cardId);
  const element = spell.element;
  addActivity(`${caster.name} cast ${ELEMENTS[element].label}.`, ELEMENTS[element].icon, "spell");

  if (element === "water") {
    const recovered = game.discard.pop();
    if (recovered) {
      caster.hand.push(recovered);
      addActivity(`${caster.name} took ${ELEMENTS[recovered.element].label} from the top of the discard pile.`, ELEMENTS[recovered.element].icon, "water");
    } else {
      addActivity("The discard pile was empty; Water recovered nothing.", ELEMENTS.water.icon, "water");
    }
    game.discard.push(spell);
    if (checkForWinner(caster)) return true;
  } else {
    game.discard.push(spell);
    if (element === "earth") {
      for (let draw = 0; draw < 2; draw += 1) {
        const card = drawOne(caster);
        if (!card) break;
        addActivity(`${caster.name} drew ${ELEMENTS[card.element].label} with Earth.`, ELEMENTS.earth.icon, "earth");
        if (checkForWinner(caster)) return true;
      }
    } else if (element === "air") {
      const target = game.players[targetPlayerIndex];
      if (!target || target === caster) return false;
      const stolen = removeFromHand(target, targetCardId);
      if (!stolen) return false;
      caster.hand.push(stolen);
      addActivity(`${caster.name} took ${ELEMENTS[stolen.element].label} from ${target.name}.`, ELEMENTS.air.icon, "air");
      if (checkForWinner(caster)) return true;
    } else if (element === "fire") {
      game.pendingFireQueue = opponentsInTurnOrder(game.currentPlayer);
      game.phase = "fire-discard";
      processFireQueue();
      return true;
    }
  }

  finishTurn();
  return true;
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
  return { type: "discard", card: chooseAIDiscard(player) };
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

  if (action.card.element === "air") {
    const needed = dominantElement(player);
    const targetIndex = opponentsInTurnOrder(game.currentPlayer).find((index) =>
      game.players[index].hand.some((card) => card.element === needed),
    );
    const target = targetIndex === undefined ? null : game.players[targetIndex];
    const stolen = target?.hand.find((card) => card.element === needed);
    if (target && stolen) castSpell(player, action.card.id, targetIndex, stolen.id);
    else castSpellWithoutAirTarget(player, action.card);
    return;
  }
  castSpell(player, action.card.id);
}

function castSpellWithoutAirTarget(caster, card) {
  const spell = removeFromHand(caster, card.id);
  if (!spell) return;
  game.discard.push(spell);
  addActivity(`${caster.name} cast Air, but nobody had a card in their set to steal.`, ELEMENTS.air.icon, "air");
  finishTurn();
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
  if (spell.element === "air" && (targetPlayerIndex === null || !targetCardId)) {
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
  if (game.phase !== "action" || game.currentPlayer !== 0 || !selectedCardId) return;
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
    `${winner.playerName} collected 7 ${ELEMENTS[winner.element].label} cards.`;
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
    $("#step-number").textContent = "FIRE!";
    spellTip.className = "spell-tip element-fire";
    spellTipTitle.textContent = "🔥 Fire: choose a card to discard";
    spellTipText.textContent = "An opponent cast Fire. Tap one card in your hand to discard it.";
    spellTip.setAttribute("aria-label", "Fire: choose a card to discard. An opponent cast Fire. Tap one card in your hand to discard it.");
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
    ? "Choose a card from an opponent's hand above to steal."
    : spell.description;
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
  addButton("Discard Spell (Draw 1)", discardAndDrawSelected, true);
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
