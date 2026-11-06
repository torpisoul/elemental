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
    icon: "🌳",
    className: "earth",
  },
  air: {
    label: "Air",
    icon: "🌬️",
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
const OPPONENT_SEATS = ["top", "left", "right"];
const SAVE_KEY = "elemental-game-save-v2";
const SIMULATION_SETTINGS_KEY = "elemental-simulation-settings-v3";
const LEGACY_SIMULATION_SETTINGS_KEYS = ["elemental-simulation-settings-v2", "elemental-simulation-settings-v1"];

const $ = (selector) => document.querySelector(selector);
const compactCardsMedia = window.matchMedia("(max-height: 560px)");
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
let discardMode = false;
let aiTimer = null;
let spellAnimationUntil = 0;
let spellResolving = false;
const incomingCardIds = new Set();
const animatingDiscardCardIds = new Set();
let discardDrawEnabled = simulationSettings.allowDiscardDraw;

function spellDescription(element, compact = false) {
  const { rules } = simulationSettings;
  const fireEffect = rules.fireDiscardsPerOpponent
    ? `Other players drop ${rules.fireDiscardsPerOpponent} card${rules.fireDiscardsPerOpponent === 1 ? "" : "s"}.`
    : "";
  const descriptions = {
    fire: fireEffect || "No effect.",
    earth: `Draw ${rules.earthDraws} card${rules.earthDraws === 1 ? "" : "s"}.`,
    water: rules.waterRecovers
      ? `Take ${rules.waterRecovers} from discard. Water stays on top.`
      : "No effect.",
    air: rules.airSteals
      ? `Pick a player. Take ${rules.airSteals} card${rules.airSteals === 1 ? "" : "s"} from them.`
      : "No effect.",
  };
  const extraDraws = rules.drawAfterAnySpell + rules.drawAfterSpell[element];
  const replacement = extraDraws
    ? `${compact ? " Draw" : " Then draw"} ${extraDraws} card${extraDraws === 1 ? "" : "s"}.`
    : "";
  if (element === "fire" && extraDraws) {
    const draw = `Draw ${extraDraws} card${extraDraws === 1 ? "" : "s"}.`;
    return fireEffect ? `${draw} Then ${fireEffect[0].toLowerCase()}${fireEffect.slice(1)}` : draw;
  }
  return `${descriptions[element]}${replacement}`;
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
  spellAnimationUntil = 0;
  spellResolving = false;
  incomingCardIds.clear();
  animatingDiscardCardIds.clear();
  const players = Array.from({ length: playerCount }, (_, index) => createPlayer(index));
  game = {
    players,
    deck: createDeck(),
    discard: [],
    currentPlayer: 0,
    turn: 1,
    phase: "draw",
    pendingFireQueue: null,
    pendingFireLitTargets: [],
    pendingFireDiscards: simulationSettings.rules.fireDiscardsPerOpponent,
    pendingHumanDiscard: null,
    pendingHumanDiscardCount: 0,
    pendingHumanDiscardIds: [],
    pendingFireCasterId: null,
    winner: null,
    log: [],
    activity: [],
  };
  selectedCardId = null;
  targetingAir = false;
  discardMode = false;
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
  game.pendingHumanDiscardCount = 0;
  game.pendingHumanDiscardIds = [];
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
  if (drawn) incomingCardIds.add(drawn.id);
  addActivity(drawn
    ? `${player.name} drew 1 card.`
    : `${player.name} could not draw because both piles are empty.`,
  drawn ? ELEMENTS[drawn.element].icon : "—", "draw");
  if (checkForWinner(player)) {
    if (drawn) {
      void animateDraw(playerIndex, captureFlight($("#draw-pile .deck-card")), drawn.id);
    }
    return;
  }
  selectedCardId = null;
  saveGame();
  render();
  if (!drawn) {
    game.phase = "action";
    saveGame();
    render();
    if (!player.isHuman) scheduleAI();
    return;
  }
  const source = captureFlight($("#draw-pile .deck-card"));
  void completeTurnDraw(playerIndex, source);
}

async function completeTurnDraw(playerIndex, source) {
  const activeGame = game;
  const drawn = activeGame.players[playerIndex].hand.at(-1);
  await animateDraw(playerIndex, source, drawn?.id);
  if (game !== activeGame || game.currentPlayer !== playerIndex || game.phase !== "draw") return;
  game.phase = "action";
  saveGame();
  render();
  if (!game.players[playerIndex].isHuman) scheduleAI();
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

function waitForAnimation(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function animateElement(element, keyframes, options) {
  if (typeof element.animate === "function") {
    const animation = element.animate(keyframes, options);
    animation.onfinish = () => animation.cancel();
  } else {
    element.classList.add("animation-fallback");
  }
}

function captureFlight(element) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return { node: element.cloneNode(true), rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
}

function captureCardAt(card, anchorElement) {
  const rect = anchorElement?.getBoundingClientRect();
  return rect?.width && rect?.height
    ? { node: makeCard(card), rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } }
    : null;
}

function reserveAnimationTime(milliseconds) {
  spellAnimationUntil = Math.max(spellAnimationUntil, Date.now() + milliseconds);
}

function seatHand(index) {
  const seat = ["bottom", ...OPPONENT_SEATS][index];
  return seat === "bottom" ? $("#human-hand") : $(`#seat-${seat} .face-up-hand`);
}

function measureCardWidth() {
  const width = $("#draw-pile .deck-stack")?.getBoundingClientRect().width;
  return Number.isFinite(width) && width > 0 ? width : null;
}

async function animateFlight(snapshot, destination, { duration = 500 } = {}) {
  if (!snapshot || !destination || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const targetRect = destination.getBoundingClientRect();
  if (!targetRect.width || !targetRect.height) return;
  const isCard = snapshot.node.classList.contains("playing-card");
  const width = isCard ? measureCardWidth() ?? snapshot.rect.width : snapshot.rect.width;
  const height = isCard ? width * 1.42 : snapshot.rect.height;
  const sourceX = snapshot.rect.left + snapshot.rect.width / 2 - width / 2;
  const sourceY = snapshot.rect.top + snapshot.rect.height / 2 - height / 2;
  const destinationX = targetRect.left + targetRect.width / 2 - width / 2;
  const destinationY = targetRect.top + targetRect.height / 2 - height / 2;
  if (![sourceX, sourceY, destinationX, destinationY, width, height].every(Number.isFinite)) {
    console.error("Card flight skipped because its measured geometry is invalid.", { source: snapshot.rect, destination: targetRect });
    return;
  }
  const flight = snapshot.node;
  flight.classList.add("card-flight");
  flight.setAttribute("aria-hidden", "true");
  Object.assign(flight.style, {
    left: `${sourceX}px`,
    top: `${sourceY}px`,
    width: `${width}px`,
    height: `${height}px`,
  });
  document.body.append(flight);
  const deltaX = destinationX - sourceX;
  const deltaY = destinationY - sourceY;
  const tilt = Math.sign(deltaX || 1) * 7;
  animateElement(flight, [
    { transform: "translate(0, 0) scale(1) rotate(0deg)" },
    {
      transform: `translate(${deltaX * .52}px, ${deltaY * .52 - 28}px) scale(.92) rotate(${tilt}deg)`,
      offset: .56,
    },
    { transform: `translate(${deltaX}px, ${deltaY}px) scale(.72) rotate(0deg)` },
  ], { duration, easing: "cubic-bezier(.2,.8,.25,1)" });
  reserveAnimationTime(duration);
  await waitForAnimation(duration + 20);
  flight.remove();
}

async function animateRay(source, target, element, duration = 300) {
  if (!source || !target || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const sourceRect = source.rect ?? source.getBoundingClientRect();
  const targetRect = target.rect ?? target.getBoundingClientRect();
  const targetLeft = targetRect.left ?? targetRect.x;
  const targetTop = targetRect.top ?? targetRect.y;
  const sourceX = sourceRect.left + sourceRect.width / 2;
  const sourceY = sourceRect.top + sourceRect.height / 2;
  const targetX = targetLeft + targetRect.width / 2;
  const targetY = targetTop + targetRect.height / 2;
  if (![sourceX, sourceY, targetX, targetY].every(Number.isFinite)) {
    console.error("Spell ray skipped because its measured geometry is invalid.", { source: sourceRect, target: targetRect });
    return;
  }
  const angle = Math.atan2(targetY - sourceY, targetX - sourceX);
  const ray = document.createElement("span");
  ray.className = `spell-ray element-${ELEMENTS[element].className}`;
  Object.assign(ray.style, {
    left: `${sourceX}px`,
    top: `${sourceY}px`,
    width: `${Math.hypot(targetX - sourceX, targetY - sourceY)}px`,
    transform: `rotate(${angle}rad) scaleX(0)`,
  });
  document.body.append(ray);
  animateElement(ray, [
    { transform: `rotate(${angle}rad) scaleX(0)` },
    { transform: `rotate(${angle}rad) scaleX(1)` },
  ], { duration, easing: "ease-out" });
  reserveAnimationTime(duration);
  await waitForAnimation(duration + 20);
  ray.remove();
}

async function animateCardReveal(snapshot) {
  if (!snapshot || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const card = snapshot.node;
  const width = measureCardWidth() ?? snapshot.rect.width;
  const height = width * 1.42;
  const left = snapshot.rect.left + snapshot.rect.width / 2 - width / 2;
  const top = snapshot.rect.top + snapshot.rect.height / 2 - height / 2;
  if (![width, height, left, top].every(Number.isFinite)) {
    console.error("Card reveal skipped because its measured geometry is invalid.", { source: snapshot.rect, width, height });
    return;
  }
  card.classList.add("card-flight", "card-reveal");
  Object.assign(card.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
  document.body.append(card);
  animateElement(card, [
    { opacity: 0, transform: "perspective(700px) rotateY(88deg) scale(.9)" },
    { opacity: 1, transform: "perspective(700px) rotateY(0deg) scale(1)" },
  ], { duration: 300, easing: "ease-out" });
  reserveAnimationTime(450);
  await waitForAnimation(450);
  card.classList.remove("card-reveal");
  card.remove();
}

async function animateDraw(index, source = captureFlight($("#draw-pile .deck-card")), cardId = null) {
  const player = game?.players[index];
  const drawnCard = player?.hand.find((card) => card.id === cardId);
  const revealedCard = drawnCard && source
    ? { node: makeCard(drawnCard), rect: source.rect }
    : null;
  if (revealedCard) await animateCardReveal(revealedCard);
  await animateIncomingCard(revealedCard ?? source, seatHand(index), cardId, { duration: 650 });
}

async function animateIncomingCard(source, destination, cardId, options = {}) {
  await animateFlight(source, destination, options);
  if (cardId) {
    incomingCardIds.delete(cardId);
    if (game) render();
  }
}

async function animateDiscardBatch(entries) {
  await Promise.all(entries.map(({ source }) =>
    animateFlight(source, $("#discard-pile"), { duration: 700 }),
  ));
  for (const { cardId } of entries) animatingDiscardCardIds.delete(cardId);
  if (game) render();
}

async function animateDiscard(snapshot, cardId) {
  if (!snapshot) {
    animatingDiscardCardIds.delete(cardId);
    if (game) render();
    return;
  }
  await animateDiscardBatch([{ source: snapshot, cardId }]);
}

async function animateAirSteal(stolen, casterIndex, casterName, targetName) {
  const destination = seatHand(casterIndex);
  const card = game.players[casterIndex].hand.find((item) => item.id === stolen.cardId);
  const callout = document.createElement("div");
  callout.className = "air-steal-callout";
  callout.textContent = `${casterName} took ${ELEMENTS[card.element].label} from ${targetName}`;
  document.body.append(callout);
  animateElement(callout, [
    { opacity: 0, transform: "translate(-50%, calc(-50% + 8px)) scale(.92)" },
    { opacity: 1, transform: "translate(-50%, -50%) scale(1)", offset: .18 },
    { opacity: 1, transform: "translate(-50%, -50%) scale(1)", offset: .78 },
    { opacity: 0, transform: "translate(-50%, calc(-50% - 5px)) scale(.98)" },
  ], { duration: 1000, easing: "ease-out" });
  reserveAnimationTime(1000);
  await Promise.all([
    animateRay(stolen.source, destination, "air", 520),
    animateIncomingCard(stolen.source, destination, stolen.cardId, { duration: 700 }),
  ]);
  callout.remove();
}

async function castSpell(caster, cardId, targetPlayerIndex = null, targetCardId = null) {
  const spellInHand = caster.hand.find((card) => card.id === cardId);
  if (!spellInHand) return false;
  const sourceCard = document.querySelector(`[data-card-id="${CSS.escape(cardId)}"]`);
  const spellFlight = captureFlight(sourceCard);
  const casterIndex = game.players.indexOf(caster);
  const targetCardElement = targetCardId
    ? document.querySelector(`[data-card-id="${CSS.escape(targetCardId)}"]`)
    : null;
  const targetCardFlight = captureFlight(targetCardElement);
  if (spellInHand.element === "air" && simulationSettings.rules.airSteals > 0 &&
      (targetPlayerIndex !== null || targetCardId !== null)) {
    const target = game.players[targetPlayerIndex];
    if (!target || target === caster || !target.hand.some((card) => card.id === targetCardId)) return false;
  }
  spellResolving = true;
  const spell = removeFromHand(caster, cardId);
  const element = spell.element;
  game.discard.push(spell);
  animatingDiscardCardIds.add(spell.id);
  addActivity(`${caster.name} cast ${ELEMENTS[element].label}.`, ELEMENTS[element].icon, "spell");

  const recoveredFlights = [];
  const drawFlights = [];
  const stolenFlights = [];
  if (element === "water") {
    let recoveredCount = 0;
    for (let recovery = 0; recovery < simulationSettings.rules.waterRecovers && game.discard.length > 1; recovery += 1) {
    const recovered = game.discard.splice(game.discard.length - 2, 1)[0];
      const source = recoveredCount === 0
        ? captureFlight($("#discard-top-card .playing-card"))
        : captureCardAt(recovered, $("#discard-pile"));
      incomingCardIds.add(recovered.id);
      recoveredFlights.push({ source, cardId: recovered.id });
      caster.hand.push(recovered);
      recoveredCount += 1;
      addActivity(`${caster.name} took ${ELEMENTS[recovered.element].label} from the top of the discard pile.`, ELEMENTS[recovered.element].icon, "water");
      if (checkForWinner(caster)) break;
    }
    if (!recoveredCount) {
      addActivity("Water recovered no cards from the discard pile.", ELEMENTS.water.icon, "water");
    }
  } else if (element === "earth") {
    for (let draw = 0; draw < simulationSettings.rules.earthDraws; draw += 1) {
      const deckFlight = captureFlight($("#draw-pile .deck-card"));
      const card = drawOne(caster);
      if (!card) break;
      incomingCardIds.add(card.id);
      drawFlights.push({ source: deckFlight, cardId: card.id });
      addActivity(`${caster.name} drew ${ELEMENTS[card.element].label} with Earth.`, ELEMENTS.earth.icon, "earth");
      if (checkForWinner(caster)) break;
    }
  } else if (element === "air") {
    if (simulationSettings.rules.airSteals > 0) {
      const target = game.players[targetPlayerIndex];
      const firstCard = target?.hand.find((card) => card.id === targetCardId);
      if (target && firstCard) {
        for (let steal = 0; steal < simulationSettings.rules.airSteals; steal += 1) {
          const stolenCard = steal === 0
            ? firstCard
            : target.hand.find((card) => card.element === firstCard.element);
          if (!stolenCard) break;
          const stolenFlight = steal === 0
            ? targetCardFlight
            : captureFlight(document.querySelector(`[data-card-id="${CSS.escape(stolenCard.id)}"]`));
          const stolen = removeFromHand(target, stolenCard.id);
          if (!stolen) break;
          stolenFlights.push({ source: stolenFlight, cardId: stolen.id, targetName: target.name });
          incomingCardIds.add(stolen.id);
          caster.hand.push(stolen);
          addActivity(`${caster.name} took ${ELEMENTS[stolen.element].label} from ${target.name}.`, ELEMENTS.air.icon, "air");
          if (checkForWinner(caster)) break;
        }
      } else {
        addActivity("Air found no card to steal.", ELEMENTS.air.icon, "air");
      }
    } else {
      addActivity("Air has no steal effect.", ELEMENTS.air.icon, "air");
    }
  } else if (element === "fire") {
    game.pendingFireQueue = simulationSettings.rules.fireDiscardsPerOpponent > 0
      ? opponentsInTurnOrder(game.currentPlayer)
      : [];
    game.pendingFireDiscards = simulationSettings.rules.fireDiscardsPerOpponent;
    game.pendingFireLitTargets = [];
    game.pendingFireCasterId = caster.id;
    game.pendingHumanDiscardIds = [];
    game.pendingHumanDiscardCount = 0;
    game.phase = "fire-discard";
    const fireDraws = game.winner ? [] : drawSpellReplacements(caster, element);
    saveGame();
    render();
    await processFireQueue(spellFlight, fireDraws);
    return true;
  }

  const spellDraws = game.winner ? [] : drawSpellReplacements(caster, element);
  render();
  if (element === "water") {
    for (const recovered of recoveredFlights) {
      await animateIncomingCard(recovered.source, seatHand(casterIndex), recovered.cardId);
    }
    await animateDiscard(spellFlight, spell.id);
  } else {
    await animateDiscard(spellFlight, spell.id);
  }
  if (element === "earth") {
    for (const drawn of drawFlights) await animateDraw(casterIndex, drawn.source, drawn.cardId);
  } else if (element === "air" && stolenFlights.length) {
    for (const stolen of stolenFlights) {
      await animateAirSteal(stolen, casterIndex, caster.name, stolen.targetName);
    }
  }
  for (const drawn of spellDraws) await animateDraw(casterIndex, drawn.source, drawn.cardId);
  spellResolving = false;
  saveGame();
  render();
  if (game.winner) return true;
  finishTurn();
  return true;
}

function drawSpellReplacements(player, element) {
  const count = simulationSettings.rules.drawAfterAnySpell + simulationSettings.rules.drawAfterSpell[element];
  const drawFlights = [];
  for (let draw = 0; draw < count; draw += 1) {
    const source = captureFlight($("#draw-pile .deck-card"));
    const card = drawOne(player);
    if (!card) break;
    incomingCardIds.add(card.id);
    drawFlights.push({ source, cardId: card.id, playerIndex: game.players.indexOf(player) });
    addActivity(`${player.name} drew ${ELEMENTS[card.element].label} to replace their ${ELEMENTS[element].label} spell.`, ELEMENTS[element].icon, "draw");
    if (checkForWinner(player)) break;
  }
  return drawFlights;
}

function chooseAIDiscard(player) {
  const target = dominantElement(player);
  return player.hand.find((card) => card.element !== target) ?? player.hand[0] ?? null;
}

async function animateFireImpact(targetIndex) {
  const seat = $(`#seat-${["bottom", ...OPPONENT_SEATS][targetIndex]}`);
  if (!seat || seat.hidden) return;
  const burst = document.createElement("span");
  const rect = seat.getBoundingClientRect();
  burst.className = "fire-hit";
  Object.assign(burst.style, {
    left: `${rect.left + rect.width / 2 - 25}px`,
    top: `${rect.top + rect.height / 2 - 25}px`,
  });
  document.body.append(burst);
  animateElement(burst, [
    { transform: "scale(.2)", opacity: 1 },
    { transform: "scale(2.2)", opacity: 0 },
  ], { duration: 520, easing: "ease-out" });
  reserveAnimationTime(520);
  await waitForAnimation(540);
  burst.remove();
}

async function processFireQueue(spellFlight = null, fireDraws = []) {
  const activeGame = game;
  spellResolving = true;
  const fireSpellId = spellFlight?.node?.dataset.cardId;
  if (spellFlight) await animateDiscard(spellFlight, fireSpellId);
  if (game !== activeGame) return;
  for (const drawn of fireDraws) {
    await animateDraw(drawn.playerIndex, drawn.source, drawn.cardId);
  }
  if (game.winner) {
    spellResolving = false;
    saveGame();
    return;
  }
  while (game.pendingFireQueue?.length && !game.winner) {
    const targetIndex = game.pendingFireQueue.shift();
    const target = game.players[targetIndex];
    if (!target.hand.length) continue;

    if (!game.pendingFireLitTargets.includes(targetIndex)) {
      game.pendingFireLitTargets.push(targetIndex);
      render();
      const seat = $(`#seat-${["bottom", ...OPPONENT_SEATS][targetIndex]}`);
      await animateRay($("#discard-pile"), seatHand(targetIndex), "fire", 420);
      if (game !== activeGame) return;
      await animateFireImpact(targetIndex);
      if (game !== activeGame) return;
    }

    if (target.isHuman) {
      game.pendingHumanDiscard = target.id;
      game.pendingHumanDiscardCount = Math.min(game.pendingFireDiscards, target.hand.length);
      game.pendingHumanDiscardIds = [];
      game.phase = "defend";
      spellResolving = false;
      saveGame();
      render();
      return;
    }

    const discards = [];
    for (let count = 0; count < Math.min(game.pendingFireDiscards, target.hand.length); count += 1) {
      const card = chooseAIDiscard(target);
      const source = captureFlight(document.querySelector(`[data-card-id="${CSS.escape(card.id)}"]`));
      if (!discardCard(target, card.id, "discarded")) break;
      animatingDiscardCardIds.add(card.id);
      discards.push({ source, cardId: card.id });
    }
    render();
    await animateDiscardBatch(discards);
    if (game !== activeGame) return;
    game.pendingFireLitTargets = game.pendingFireLitTargets.filter((index) => index !== targetIndex);
    render();
  }

  for (const targetIndex of game.pendingFireLitTargets) {
    $(`#seat-${["bottom", ...OPPONENT_SEATS][targetIndex]}`)?.classList.remove("fire-burning");
  }
  game.pendingFireLitTargets = [];
  game.pendingFireQueue = null;
  game.pendingHumanDiscard = null;
  game.pendingHumanDiscardCount = 0;
  game.pendingHumanDiscardIds = [];
  const caster = game.players.find((player) => player.id === game.pendingFireCasterId);
  game.pendingFireCasterId = null;
  spellResolving = false;
  if (game.winner) {
    saveGame();
    return;
  }
  if (!game.winner) {
    game.phase = "action";
    render();
    finishTurn();
  }
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

async function runAITurn() {
  if (game.winner || game.phase !== "action" || game.players[game.currentPlayer].isHuman) return;
  const player = game.players[game.currentPlayer];
  const action = chooseAIAction(player);
  if (action.type === "pass") {
    finishTurn();
    return;
  }
  if (action.type === "discard") {
    const discardFlight = captureFlight(document.querySelector(`[data-card-id="${CSS.escape(action.card.id)}"]`));
    const drawFlight = captureFlight($("#draw-pile .deck-card"));
    if (!discardCard(player, action.card.id)) return;
    animatingDiscardCardIds.add(action.card.id);
    const drawn = drawOne(player);
    if (drawn) {
      incomingCardIds.add(drawn.id);
      addActivity(`${player.name} drew 1 card after discarding.`, ELEMENTS[drawn.element].icon, "draw");
      checkForWinner(player);
    }
    render();
    await animateDiscard(discardFlight, action.card.id);
    if (drawn) await animateDraw(game.players.indexOf(player), drawFlight, drawn.id);
    if (game.winner) return;
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
    if (target && stolen) await castSpell(player, action.card.id, targetIndex, stolen.id);
    else await castSpell(player, action.card.id);
    return;
  }
  await castSpell(player, action.card.id);
}

function scheduleAI() {
  window.clearTimeout(aiTimer);
  const animationDelay = Math.max(0, spellAnimationUntil - Date.now());
  const delay = Math.max(1600, animationDelay + 150);
  aiTimer = window.setTimeout(() => {
    if (!game || game.winner || game.phase !== "action" || game.players[game.currentPlayer].isHuman) return;
    void runAITurn().then(() => {
      saveGame();
      render();
    }).catch((error) => {
      console.error("AI turn failed.", error);
    });
  }, delay);
}

async function selectHumanCard(cardId) {
  if (game.phase === "defend" && game.pendingHumanDiscard === game.players[0].id) {
    const selectedIds = game.pendingHumanDiscardIds ??= [];
    if (selectedIds.includes(cardId)) {
      game.pendingHumanDiscardIds = selectedIds.filter((id) => id !== cardId);
      saveGame();
      render();
      return;
    }
    if (selectedIds.length >= game.pendingHumanDiscardCount) return;
    selectedIds.push(cardId);
    if (selectedIds.length < game.pendingHumanDiscardCount) {
      saveGame();
      render();
      return;
    }

    const player = game.players[0];
    const discards = selectedIds.map((id) => ({
      source: captureFlight(document.querySelector(`[data-card-id="${CSS.escape(id)}"]`)),
      cardId: id,
    }));
    for (const { cardId: id } of discards) {
      if (!discardCard(player, id, "chose to discard")) continue;
      animatingDiscardCardIds.add(id);
    }
    game.pendingHumanDiscard = null;
    game.pendingHumanDiscardCount = 0;
    game.pendingHumanDiscardIds = [];
    game.phase = "fire-discard";
    spellResolving = true;
    saveGame();
    render();
    await animateDiscardBatch(discards);
    game.pendingFireLitTargets = (game.pendingFireLitTargets ?? []).filter((index) => index !== 0);
    render();
    await processFireQueue();
    saveGame();
    render();
    return;
  }
  if (game.phase !== "action" || game.currentPlayer !== 0) return;
  const player = game.players[0];
  const card = player.hand.find((item) => item.id === cardId);
  if (!card) return;
  if (discardMode) {
    await discardAndDrawCard(cardId);
    return;
  }
  if (card.element === "air" && simulationSettings.rules.airSteals > 0) {
    selectedCardId = card.id;
    targetingAir = true;
    render();
    return;
  }
  selectedCardId = null;
  targetingAir = false;
  await castSpell(player, card.id);
}

async function humanCastSelected(targetPlayerIndex = null, targetCardId = null) {
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
  discardMode = false;
  await castSpell(game.players[0], spell.id, targetPlayerIndex, targetCardId);
}

async function discardAndDrawCard(cardId) {
  if (!discardDrawEnabled || game.phase !== "action" || game.currentPlayer !== 0) return;
  const player = game.players[0];
  const discardFlight = captureFlight(document.querySelector(`[data-card-id="${CSS.escape(cardId)}"]`));
  if (!discardCard(player, cardId)) return;
  animatingDiscardCardIds.add(cardId);
  selectedCardId = null;
  targetingAir = false;
  discardMode = false;
  const drawFlight = captureFlight($("#draw-pile .deck-card"));
  const drawn = drawOne(player);
  if (drawn) {
    incomingCardIds.add(drawn.id);
    addActivity(`You drew ${ELEMENTS[drawn.element].label} after discarding.`, ELEMENTS[drawn.element].icon, "draw");
    checkForWinner(player);
  } else {
    addActivity("You could not draw a replacement because both piles are empty.", "—", "draw");
  }
  saveGame();
  render();
  await animateDiscard(discardFlight, cardId);
  if (drawn) await animateDraw(0, drawFlight, drawn.id);
  saveGame();
  if (game.winner) return;
  finishTurn();
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
  const cardElement = document.createElement("div");
  cardElement.className = `playing-card element-${data.className}${options.selected ? " selected" : ""}`;
  cardElement.dataset.cardId = card.id;
  cardElement.setAttribute("aria-hidden", "true");
  const heading = document.createElement("span");
  heading.className = "card-heading";
  const label = document.createElement("strong");
  label.textContent = data.label;
  const icon = document.createElement("span");
  icon.className = "card-icon";
  icon.textContent = data.icon;
  heading.append(label);
  const description = document.createElement("span");
  description.className = "card-description";
  description.textContent = spellDescription(
    card.element,
    compactCardsMedia.matches,
  );
  const footer = document.createElement("span");
  footer.className = "card-footer";
  footer.textContent = "ELEMENTAL";
  cardElement.append(icon, heading, description, footer);
  return cardElement;
}

function renderHand(player, { human = false, defending = false, opponentIndex = -1, seat = "bottom" } = {}) {
  const hand = document.createElement("div");
  hand.className = `face-up-hand${human ? " human-hand" : ""} seat-hand seat-hand-${seat}`;
  hand.setAttribute("aria-label", `${player.name}'s face-up hand`);

  const isSideSeat = seat === "left" || seat === "right";
  const cardsByElement = isSideSeat
    ? ELEMENT_ORDER.map((element) => player.hand.filter((card) => card.element === element)).filter((cards) => cards.length)
    : [player.hand];

  for (const cards of cardsByElement) {
    const stack = isSideSeat ? document.createElement("div") : hand;
    if (isSideSeat) {
      stack.className = `side-card-stack element-${ELEMENTS[cards[0].element].className}`;
      stack.setAttribute("aria-label", `${cards.length} ${ELEMENTS[cards[0].element].label} card${cards.length === 1 ? "" : "s"}`);
      hand.append(stack);
    }
    for (const card of cards) {
      const selected = human && (card.id === selectedCardId ||
        defending && game.pendingHumanDiscardIds?.includes(card.id));
      const incoming = incomingCardIds.has(card.id);
      const isAirTarget = !human && targetingAir;
      const canChoose = human
        ? defending || !spellResolving && game.currentPlayer === 0 && game.phase === "action"
        : isAirTarget && !spellResolving;
      const cardButton = document.createElement("button");
      cardButton.className = `hand-card-button${selected ? " selected" : ""}${incoming ? " incoming" : ""}${canChoose ? " interactive" : ""}`;
      cardButton.type = "button";
      cardButton.disabled = !canChoose;
      if (canChoose) {
        cardButton.addEventListener("click", () => {
          if (defending || human) {
            selectHumanCard(card.id);
          } else {
            humanCastSelected(opponentIndex, card.id);
          }
        });
      }
      cardButton.setAttribute("aria-label", defending
        ? `Discard ${ELEMENTS[card.element].label}`
        : isAirTarget
          ? `Take ${ELEMENTS[card.element].label} from ${player.name}`
          : `${ELEMENTS[card.element].label}: ${spellDescription(card.element)}`);
      cardButton.append(makeCard(card, { selected }));
      stack.append(cardButton);
    }
  }
  return hand;
}

function renderPlayers() {
  $("#table-layout").classList.toggle("human-turn", game.currentPlayer === 0 && !game.winner);
  for (const seat of OPPONENT_SEATS) {
    const container = $(`#seat-${seat}`);
    const index = OPPONENT_SEATS.indexOf(seat) + 1;
    const player = game.players[index];
    container.hidden = !player;
    container.replaceChildren();
    if (!player) continue;
    const active = index === game.currentPlayer && !game.winner;
    container.classList.toggle("active", active);
    container.classList.toggle("targeting", targetingAir && !player.isHuman);
    container.classList.toggle("fire-burning", (game.pendingFireLitTargets ?? []).includes(index));
    const heading = document.createElement("div");
    heading.className = "player-heading";
    const name = document.createElement("strong");
    name.textContent = player.name;
    const status = document.createElement("span");
    status.className = "player-status";
    status.textContent = active ? "THEIR TURN" : "";
    heading.append(name, status);
    container.append(heading, renderHand(player, { opponentIndex: index, seat }));
  }

  const human = game.players[0];
  const humanHandBoard = $("#human-hand-board");
  humanHandBoard.classList.toggle("active", game.currentPlayer === 0 && !game.winner);
  const defending = game.phase === "defend" && game.pendingHumanDiscard === human.id;
  humanHandBoard.classList.toggle("defending", defending);
  humanHandBoard.classList.toggle("fire-burning", (game.pendingFireLitTargets ?? []).includes(0));
  $("#human-status").textContent = defending
    ? `CHOOSE ${game.pendingHumanDiscardCount} TO DISCARD`
    : game.phase === "draw"
      ? "DRAWING A CARD"
      : spellResolving && game.currentPlayer === 0
        ? "RESOLVING SPELL"
      : discardMode && game.currentPlayer === 0 && game.phase === "action"
        ? "DISCARD MODE"
    : game.currentPlayer === 0 && game.phase === "action"
      ? "YOUR TURN!"
      : "WAITING";
  const humanHand = $("#human-hand");
  humanHand.classList.toggle("defending-hand", defending);
  humanHand.setAttribute("aria-label", "Your face-up hand");
  humanHand.replaceChildren(...renderHand(human, { human, defending, seat: "bottom" }).childNodes);
}

function renderActions() {
  controlsElement.replaceChildren();
  const card = game.players[0].hand.find((item) => item.id === selectedCardId);
  const addButton = (label, action, secondary = false) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `action-button${secondary ? " secondary" : ""}`;
    button.textContent = label;
    button.addEventListener("click", action);
    controlsElement.append(button);
  };

  if (game.winner) {
    return;
  }
  if (game.phase === "defend") {
    if (!game.pendingHumanDiscard) {
      $("#human-status").textContent = "FIRE: CARDS IN FLIGHT";
      return;
    }
    const selectedCount = game.pendingHumanDiscardIds?.length ?? 0;
    $("#human-status").textContent = `FIRE: DISCARD ${selectedCount}/${game.pendingHumanDiscardCount}`;
    return;
  }
  if (game.currentPlayer !== 0 || spellResolving) return;
  if (game.phase === "draw") {
    $("#human-status").textContent = "DRAWING A CARD";
    return;
  }
  if (game.phase !== "action") return;
  if (targetingAir && card?.element === "air") {
    $("#human-status").textContent = "SELECT A CARD TO STEAL";
    addButton("Cancel", () => {
      targetingAir = false;
      render();
    }, true);
  }
  if (discardDrawEnabled) {
    addButton(discardMode ? "Cancel discard" : "Discard 1, Draw 1", () => {
      discardMode = !discardMode;
      selectedCardId = null;
      targetingAir = false;
      render();
    }, true);
  }
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
    $("#new-game-button").hidden = true;
    $("#log-button").hidden = true;
    welcomeScreen.classList.remove("hidden");
    gameScreen.classList.add("hidden");
    return;
  }
  $("#new-game-button").hidden = false;
  $("#log-button").hidden = false;
  welcomeScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  $("#phase-title").textContent = game.winner
    ? `${game.winner.playerName} wins with ${ELEMENTS[game.winner.element].label}.`
    : game.phase === "defend"
      ? "Defend against Fire"
    : game.phase === "draw"
      ? "Drawing a card"
    : game.phase === "fire-discard"
      ? "Fire is resolving"
    : spellResolving
      ? "Resolving spell"
    : game.currentPlayer === 0
      ? "Your turn"
        : `${game.players[game.currentPlayer].name} is playing`;
  $("#deck-count").textContent = String(game.deck.length);
  $("#draw-pile .deck-stack").classList.toggle("empty", game.deck.length === 0);
  $("#discard-count").textContent = String(game.discard.length);
  $("#discard-count-label").textContent = game.discard.length === 1 ? "card" : "cards";
  $("#round-count").textContent = String(game.turn);
  $("#discard-pile").classList.toggle("has-cards", game.discard.length > 0);
  const top = game.discard.at(-1);
  const topCard = $("#discard-top-card");
  const topIsMoving = top && animatingDiscardCardIds.has(top.id);
  topCard.className = topIsMoving ? "top-card in-flight" : top ? "top-card" : "top-card empty";
  topCard.replaceChildren(topIsMoving ? document.createDocumentFragment() :
    top ? makeCard(top) : document.createTextNode("Empty"));
  renderPlayers();
  renderActions();
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
    game.pendingFireLitTargets ??= [];
    game.pendingHumanDiscardIds ??= [];
    game.pendingHumanDiscardCount ??= 0;
    if (!Number.isInteger(game.pendingFireDiscards)) {
      const oldQueue = game.pendingFireQueue ?? [];
      const frequencies = oldQueue.reduce((counts, index) => {
        counts[index] = (counts[index] ?? 0) + 1;
        return counts;
      }, {});
      game.pendingFireDiscards = Math.max(1, ...Object.values(frequencies), simulationSettings.rules.fireDiscardsPerOpponent);
      if (game.phase === "defend" && game.pendingHumanDiscard) {
        const humanIndex = game.players.findIndex((player) => player.id === game.pendingHumanDiscard);
        game.pendingHumanDiscardCount = 1 + (frequencies[humanIndex] ?? 0);
        game.pendingFireQueue = oldQueue.filter((index) => index !== humanIndex);
      }
    }
    if (Array.isArray(game.pendingFireQueue)) {
      game.pendingFireQueue = [...new Set(game.pendingFireQueue)];
    }
    game.activity ??= [];
    game.log ??= [];
    spellResolving = false;
    incomingCardIds.clear();
    animatingDiscardCardIds.clear();
    selectedCardId = null;
    discardMode = false;
    render();
    if (!game.winner && game.phase === "draw") {
      void completeTurnDraw(game.currentPlayer, captureFlight($("#draw-pile .deck-card")));
    } else if (!game.winner && game.phase === "fire-discard") {
      void processFireQueue();
    } else if (!game.winner && game.phase !== "defend" && !game.players[game.currentPlayer].isHuman) {
      scheduleAI();
    }
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
    ["earth", "🌳", "Earth"],
    ["water", "💧", "Water"],
    ["air", "🌬️", "Air"],
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
compactCardsMedia.addEventListener("change", () => {
  if (game) render();
});
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
