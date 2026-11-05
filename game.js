const SPELLS = {
  fire: {
    icon: "🔥",
    label: "Fire",
    color: "fire",
    basic: "Discard 1 Mana from a chosen opponent.",
    enhanced: "Discard 1 Mana from every opponent.",
  },
  earth: {
    icon: "🌿",
    label: "Earth",
    color: "earth",
    basic: "Block the next spell targeting your Altar.",
    enhanced: "Block all spells targeting your Altar until your next turn.",
  },
  water: {
    icon: "💧",
    label: "Water",
    color: "water",
    basic: "Choose 1 Mana from the discard pile for your Altar.",
    enhanced: "Choose up to 2 Mana from the discard pile for your Altar.",
  },
  air: {
    icon: "⚡",
    label: "Air",
    color: "air",
    basic: "Steal a chosen opponent's highest Mana to your Altar.",
    enhanced: "Steal up to 2 of a chosen opponent's highest Mana to your Altar.",
  },
};
const PLAYER_NAMES = ["You", "Ash", "Bramble", "Current", "Zephyr"];
const SAVE_KEY = "elemental-altars-save-v1";

const $ = (selector) => document.querySelector(selector);
const welcomeScreen = $("#welcome-screen");
const gameScreen = $("#game-screen");
const handElement = $("#hand-cards");
const controlsElement = $("#action-controls");
let game = null;
let selectedCardId = null;
let selectedFuelIds = [];
let selectedDiscardIds = [];
let resolvingAI = false;
let resolvingSpell = false;
let matchGeneration = 0;

function createDeck() {
  const cards = [];
  for (let value = 1; value <= 4; value += 1) {
    for (let copy = 0; copy < 10; copy += 1) cards.push({ id: crypto.randomUUID(), kind: "mana", value });
  }
  for (let copy = 0; copy < 8; copy += 1) cards.push({ id: crypto.randomUUID(), kind: "mana", value: 5 });
  for (let value = 6; value <= 7; value += 1) {
    for (let copy = 0; copy < 6; copy += 1) cards.push({ id: crypto.randomUUID(), kind: "mana", value });
  }
  for (const element of Object.keys(SPELLS)) {
    for (let copy = 0; copy < 10; copy += 1) cards.push({ id: crypto.randomUUID(), kind: "spell", element });
  }
  return shuffle(cards);
}

function shuffle(cards) {
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [cards[index], cards[other]] = [cards[other], cards[index]];
  }
  return cards;
}

function createPlayer(index) {
  return {
    id: `player-${index}`,
    name: PLAYER_NAMES[index],
    hand: [],
    altar: [],
    vault: [],
    shield: null,
    isHuman: index === 0,
  };
}

function newGame() {
  matchGeneration += 1;
  resolvingAI = false;
  resolvingSpell = false;
  const players = PLAYER_NAMES.map((_, index) => createPlayer(index));
  game = {
    players,
    deck: createDeck(),
    discard: [],
    currentPlayer: 0,
    turn: 1,
    phase: "stage",
    spellCastThisTurn: false,
    spellResolutionPending: false,
    humanTurns: 0,
    spellFuelMisses: 0,
    humanLowManaRedraws: 0,
    opponentLowManaRedraws: 0,
    winner: null,
    log: [],
    activity: [],
  };
  for (const player of players) drawTo(player, 5);
  addLog("The game begins. Your turn.");
  prepareHumanTurn();
  selectedCardId = null;
  selectedFuelIds = [];
  selectedDiscardIds = [];
  saveGame();
  render();
}

function drawOne(player) {
  if (game.deck.length === 0 && game.discard.length > 0) {
    game.deck = shuffle(game.discard);
    game.discard = [];
    addLog("The discard pile was shuffled to form a new draw pile.");
  }
  const card = game.deck.pop();
  if (!card) return false;
  player.hand.push(card);
  return true;
}

function drawTo(player, targetCount) {
  while (player.hand.length < targetCount && drawOne(player)) {}
}

function prepareHumanTurn() {
  game.spellCastThisTurn = false;
  const player = game.players[0];
  expireShield(player);
  if (manaCards(player).length >= 2) return;
  player.hand.forEach(discard);
  player.hand = [];
  drawTo(player, 5);
  game.humanLowManaRedraws += 1;
  addActivity(
    `You had fewer than 2 Mana, so you discarded your hand and drew 5 new cards. The new hand has ${manaCards(player).length} Mana.`,
    [player.id],
    "🔄",
    "redraw",
  );
}

function manaCards(player) {
  return player.hand.filter((card) => card.kind === "mana");
}

function spellCards(player) {
  return player.hand.filter((card) => card.kind === "spell");
}

function addLog(message) {
  if (!game) return;
  game.log.unshift(message);
  game.log = game.log.slice(0, 40);
}

function addActivity(message, playerIds = [], symbol = "✦", type = "action") {
  if (!game) return;
  addLog(message);
  const action = { id: crypto.randomUUID(), message, playerIds, symbol, type };
  game.activity ??= [];
  game.activity.unshift(action);
  game.activity = game.activity.slice(0, 8);
}

function score(player) {
  return player.vault.reduce((total, card) => total + (card.value ?? 0), 0);
}

function possessive(player) {
  return player.isHuman ? "your" : `${player.name}'s`;
}

function winCondition(player) {
  if (score(player) >= 46) return "Hoarder";
  if (player.vault.length >= 10) return "Collector";
  return null;
}

function discard(card) {
  game.discard.push(card);
}

function canCast(player) {
  return spellCards(player).length > 0 && manaCards(player).length >= 1;
}

function stageMana(player, cardId) {
  const index = player.hand.findIndex((card) => card.id === cardId && card.kind === "mana");
  if (index < 0) return false;
  const [card] = player.hand.splice(index, 1);
  player.altar.push(card);
  addActivity(`${player.name} staged ${card.value} Mana on their Altar.`, [player.id], "✦", "stage");
  return true;
}

function claimAltar(player) {
  if (player.altar.length === 0) return;
  const points = player.altar.reduce((total, card) => total + card.value, 0);
  const count = player.altar.length;
  player.vault.push(...player.altar);
  player.altar = [];
  addActivity(
    `${player.isHuman ? "You" : player.name} claimed ${count} Mana (${points} points) from ${possessive(player)} Altar.`,
    [player.id],
    "🏆",
    "claim",
  );
}

function activeOpponents(player) {
  return game.players.filter((other) => other !== player);
}

function absorbSpell(target, caster, spell) {
  if (!target.shield) return false;
  const enhanced = target.shield.enhanced;
  if (!enhanced) target.shield = null;
  const casterName = caster.isHuman ? "Your" : `${caster.name}'s`;
  const shieldName = `${possessive(target)} ${enhanced ? "enhanced " : ""}Earth shield`;
  const expiry = target.isHuman ? "your next turn" : `${target.name}'s next turn`;
  addActivity(
    `${casterName} ${SPELLS[spell.element].label} spell was blocked by ${shieldName}${enhanced ? ` and remains active until ${expiry}` : ""}.`,
    [caster.id, target.id],
    "🛡️",
    "blocked",
  );
  return true;
}

function expireShield(player) {
  if (!player.shield) return;
  player.shield = null;
  const ownerTurn = player.isHuman ? "your turn" : `${player.name}'s turn`;
  addActivity(
    `${player.isHuman ? "Your" : `${player.name}'s`} Earth shield expired at the start of ${ownerTurn}.`,
    [player.id],
    "🛡️",
    "shield",
  );
}

function highestAltarOpponent(caster) {
  return activeOpponents(caster)
    .filter((player) => player.altar.length > 0)
    .sort((a, b) => altarPoints(b) - altarPoints(a) || a.id.localeCompare(b.id))[0] ?? null;
}

function altarPoints(player) {
  return player.altar.reduce((total, card) => total + card.value, 0);
}

function resolveSpell(player, spell, enhanced, targetId = null, discardCardIds = []) {
  switch (spell.element) {
    case "fire": {
      const targets = enhanced
        ? activeOpponents(player)
        : [game.players.find((other) => other.id === targetId)].filter(Boolean);
      const outcomes = [];
      const affectedIds = [];
      for (const target of targets) {
        const altarName = `${possessive(target)} Altar`;
        if (target.altar.length === 0) {
          outcomes.push(`${altarName} had no Mana`);
          continue;
        }
        if (absorbSpell(target, player, spell)) {
          outcomes.push(`${possessive(target)} shield blocked it`);
          affectedIds.push(target.id);
          continue;
        }
        const [lost] = target.altar.splice(Math.floor(Math.random() * target.altar.length), 1);
        discard(lost);
        outcomes.push(`${altarName} lost 1 Mana`);
        affectedIds.push(target.id);
      }
      addActivity(
        outcomes.length ? `${enhanced ? "Enhanced " : ""}Fire: ${outcomes.join("; ")}.` : "Fire found no target.",
        [player.id, ...affectedIds],
        "🔥",
        "fire",
      );
      break;
    }
    case "earth": {
      player.shield = { enhanced };
      const duration = player.isHuman ? "your next turn" : `${player.name}'s next turn`;
      addActivity(
        `${player.name} raised an ${enhanced ? `enhanced Earth shield that blocks all spells targeting ${possessive(player)} Altar until ${duration}.` : `Earth shield that blocks the next spell targeting ${possessive(player)} Altar.`}`,
        [player.id],
        "🛡️",
        "shield",
      );
      break;
    }
    case "water": {
      const count = enhanced ? 2 : 1;
      const recovered = discardCardIds.slice(0, count).map((id) => {
        const index = game.discard.findIndex((card) => card.id === id && card.kind === "mana");
        return index < 0 ? null : game.discard.splice(index, 1)[0];
      }).filter(Boolean);
      player.altar.push(...recovered);
      addActivity(
        recovered.length
          ? `${player.name} recovered ${recovered.map((card) => card.value).join(", ")} Mana from the discard pile to ${possessive(player)} Altar with Water.`
          : "Water had no discarded Mana to reclaim.",
        [player.id],
        "💧",
        "water",
      );
      break;
    }
    case "air": {
      const target = game.players.find((other) => other.id === targetId) ?? highestAltarOpponent(player);
      if (!target) {
        addActivity("Air found no Mana on an opponent's Altar.", [player.id], "⚡", "air");
        break;
      }
      if (absorbSpell(target, player, spell)) break;
      const stolen = [...target.altar]
        .sort((a, b) => b.value - a.value)
        .slice(0, enhanced ? 2 : 1);
      const stolenIds = new Set(stolen.map((card) => card.id));
      target.altar = target.altar.filter((card) => !stolenIds.has(card.id));
      player.altar.push(...stolen);
      if (enhanced) {
        addActivity(
          `${player.name} stole ${stolen.map((card) => card.value).join(", ")} Mana from ${target.name} to ${possessive(player)} Altar.`,
          [player.id, target.id],
          "⚡",
          "air",
        );
      } else {
        addActivity(
          `${player.name} stole ${stolen[0].value} Mana from ${target.name} to ${possessive(player)} Altar.`,
          [player.id, target.id],
          "⚡",
          "air",
        );
      }
      break;
    }
    default:
      throw new Error(`Unknown spell element: ${spell.element}`);
  }
}

function castSpell(player, spellId, fuelIds, targetId = null, discardCardIds = []) {
  if (game.spellCastThisTurn) return false;
  const spellIndex = player.hand.findIndex((card) => card.id === spellId && card.kind === "spell");
  const fuelCount = fuelIds.length;
  if (spellIndex < 0 || ![1, 2].includes(fuelCount) || new Set(fuelIds).size !== fuelCount) return false;
  const fuelIndexes = fuelIds.map((id) => player.hand.findIndex((card) => card.id === id && card.kind === "mana"));
  if (fuelIndexes.some((index) => index < 0)) return false;
  const isWater = player.hand[spellIndex].element === "water";
  if (new Set(discardCardIds).size !== discardCardIds.length ||
      discardCardIds.some((id) => !game.discard.some((card) => card.id === id && card.kind === "mana")) ||
      isWater && (discardCardIds.length < 1 || discardCardIds.length > fuelCount) ||
      !isWater && discardCardIds.length > 0) return false;
  const spell = player.hand.splice(spellIndex, 1)[0];
  for (const id of fuelIds) {
    const index = player.hand.findIndex((card) => card.id === id);
    discard(player.hand.splice(index, 1)[0]);
  }
  discard(spell);
  game.spellCastThisTurn = true;
  addActivity(
    `${player.name} cast ${SPELLS[spell.element].label} (${fuelCount === 2 ? "enhanced" : "basic"}).`,
    [player.id],
    SPELLS[spell.element].icon,
    "spell",
  );
  resolveSpell(player, spell, fuelCount === 2, targetId, discardCardIds);
  return true;
}

function canStageNow() {
  const player = game.players[0];
  return game.currentPlayer === 0 && game.phase === "stage" && !game.winner && manaCards(player).length > 0;
}

function onCardClick(card, originRect) {
  if (!game || game.currentPlayer !== 0 || game.winner || resolvingAI || resolvingSpell) return;
  const player = game.players[0];
  if (game.phase === "stage") {
    if (card.kind !== "mana") return;
    stageHumanMana(card, originRect);
  } else if (game.phase === "spell") {
    if (game.spellCastThisTurn || game.spellResolutionPending) return;
    if (card.kind === "spell") {
      selectedCardId = selectedCardId === card.id ? null : card.id;
      selectedFuelIds = [];
      selectedDiscardIds = [];
    } else if (card.kind === "mana" && selectedCardId && selectedCardId !== card.id) {
      selectedFuelIds = selectedFuelIds.includes(card.id)
        ? selectedFuelIds.filter((id) => id !== card.id)
        : [...selectedFuelIds, card.id].slice(-2);
      selectedDiscardIds = selectedDiscardIds.slice(0, selectedFuelIds.length);
    } else if (card.kind === "mana" && !selectedCardId && canCast(player)) {
      selectedCardId = spellCards(player)[0].id;
      selectedFuelIds = [card.id];
      selectedDiscardIds = [];
    }
  }
  render();
}

async function stageHumanMana(card, originRect) {
  const player = game.players[0];
  if (game.phase !== "stage" || !canStageNow() || !stageMana(player, card.id)) return;
  selectedCardId = null;
  game.phase = "spell";
  saveGame();
  render();
  try {
    await animateCardFlight(card, originRect, $("#human-altar"));
  } catch (error) {
    console.error("Mana staging animation failed.", error);
  }
}

function endHumanTurn() {
  if (game.phase !== "spell" || game.winner) return;
  selectedCardId = null;
  selectedFuelIds = [];
  selectedDiscardIds = [];
  finishTurn(game.players[0]);
}

function finishTurn(player) {
  game.spellResolutionPending = false;
  if (player.isHuman) {
    game.humanTurns += 1;
    if (!game.spellCastThisTurn && manaCards(player).length === 0 && spellCards(player).length > 0) {
      game.spellFuelMisses += 1;
      addLog("You had Spell cards but no Mana fuel available after staging.");
    }
  }
  if (player.isHuman) drawTo(player, 5);
  const path = winCondition(player);
  if (path) {
    game.winner = { playerId: player.id, playerName: player.name, path };
    addLog(`${player.name} wins by the ${path} path!`);
    saveGame();
    render();
    showResult();
    return;
  }
  if (player.isHuman) {
    game.currentPlayer = 1;
    game.phase = "ai";
    game.spellCastThisTurn = false;
    saveGame();
    render();
    runAITurns();
    return;
  }
  const next = player.id === game.players.at(-1).id ? 0 : game.players.indexOf(player) + 1;
  if (next === 0) {
    game.turn += 1;
    game.phase = "stage";
    claimAltar(game.players[0]);
    addLog(`Turn ${game.turn}. Your turn.`);
    prepareHumanTurn();
  } else {
    game.currentPlayer = next;
    game.phase = "ai";
  }
  selectedCardId = null;
  selectedFuelIds = [];
  selectedDiscardIds = [];
  saveGame();
  render();
  if (game.currentPlayer !== 0) scheduleAI();
}

function chooseAIPlay(player) {
  const spells = spellCards(player);
  const mana = manaCards(player);
  const rankedSpells = spells.map((spell) => {
    const possible = spell.element === "water"
      ? game.discard.some((card) => card.kind === "mana")
      : spell.element === "earth"
        ? !player.shield
        : spell.element === "air"
          ? Boolean(highestAltarOpponent(player))
          : activeOpponents(player).some((other) => other.altar.length > 0 && !other.shield);
    return { spell, possible };
  }).filter((entry) => entry.possible);
  if (!rankedSpells.length || mana.length === 0) return null;
  const spellRank = { air: 4, fire: 3, water: 2, earth: 1 };
  rankedSpells.sort((a, b) => spellRank[b.spell.element] - spellRank[a.spell.element]);
  const spell = rankedSpells[0].spell;
  const enhanced = mana.length >= 2 && (
    spell.element === "water" && game.discard.filter((card) => card.kind === "mana").length >= 2 ||
    spell.element === "fire" && activeOpponents(player).filter((other) => other.altar.length > 0 && !other.shield).length >= 2 ||
    spell.element === "earth" && activeOpponents(player).some((other) => spellCards(other).length > 0) ||
    spell.element === "air" && Math.random() > 0.45
  );
  const fuel = [...mana].sort((a, b) => a.value - b.value).slice(0, enhanced ? 2 : 1);
  return { spell, fuel, enhanced };
}

function runAITurn(player) {
  game.spellCastThisTurn = false;
  expireShield(player);
  claimAltar(player);
  const mana = manaCards(player);
  if (mana.length >= 2) {
    const staged = [...mana].sort((a, b) => b.value - a.value)[0];
    stageMana(player, staged.id);
  } else {
    player.hand.forEach(discard);
    player.hand = [];
    drawTo(player, 5);
    game.opponentLowManaRedraws += 1;
    addActivity(
      `${player.name} had fewer than 2 Mana, so they discarded their hand and drew 5 new cards. The new hand has ${manaCards(player).length} Mana.`,
      [player.id],
      "🔄",
      "redraw",
    );
    const redrawnMana = manaCards(player);
    if (redrawnMana.length > 0) stageMana(player, redrawnMana.sort((a, b) => b.value - a.value)[0].id);
  }
  const play = chooseAIPlay(player);
  if (play) {
    const target = play.spell.element === "fire" && !play.enhanced
      ? activeOpponents(player).filter((other) => other.altar.length > 0 && !other.shield).sort((a, b) => altarPoints(b) - altarPoints(a))[0]?.id
      : null;
    const discardTargets = play.spell.element === "water"
      ? game.discard.filter((card) => card.kind === "mana")
        .sort((a, b) => b.value - a.value)
        .slice(0, play.enhanced ? 2 : 1)
        .map((card) => card.id)
      : [];
    castSpell(player, play.spell.id, play.fuel.map((card) => card.id), target, discardTargets);
  }
  drawTo(player, 5);
}

function scheduleAI() {
  if (resolvingAI || game.winner) return;
  resolvingAI = true;
  const generation = matchGeneration;
  window.setTimeout(async () => {
    if (generation !== matchGeneration) return;
    if (!game || game.winner || game.currentPlayer === 0) {
      resolvingAI = false;
      return;
    }
    const player = game.players[game.currentPlayer];
    const previousActions = new Set((game.activity ?? []).map((action) => action.id));
    runAITurn(player);
    const actions = (game.activity ?? []).filter((action) => !previousActions.has(action.id)).reverse();
    render();
    try {
      await animateTableActions(actions);
    } catch (error) {
      console.error("Opponent action animation failed.", error);
    }
    if (generation !== matchGeneration) return;
    const path = winCondition(player);
    if (path) {
      game.winner = { playerId: player.id, playerName: player.name, path };
      addLog(`${player.name} wins by the ${path} path!`);
      resolvingAI = false;
      saveGame();
      render();
      showResult();
      return;
    }
    const next = game.currentPlayer === game.players.length - 1 ? 0 : game.currentPlayer + 1;
    if (next === 0) {
      game.currentPlayer = 0;
      game.turn += 1;
      game.phase = "stage";
      claimAltar(game.players[0]);
      addLog(`Turn ${game.turn}. Your turn.`);
      prepareHumanTurn();
    } else {
      game.currentPlayer = next;
    }
    resolvingAI = false;
    saveGame();
    render();
    if (game.currentPlayer !== 0) scheduleAI();
  }, 550);
}

function runAITurns() {
  scheduleAI();
}

function makeCard(card, selectable = true) {
  const selected = card.id === selectedCardId || selectedFuelIds.includes(card.id);
  const spell = card.kind === "spell" ? SPELLS[card.element] : null;
  const button = document.createElement("button");
  button.type = "button";
  button.className = `card ${spell ? `spell-${spell.color}` : ""}${selected ? " selected" : ""}`;
  button.dataset.cardId = card.id;
  button.disabled = !selectable;
  button.setAttribute("aria-pressed", String(selected));
  button.setAttribute(
    "aria-label",
    spell
      ? `${spell.label} spell. Basic: ${spell.basic} Enhanced: ${spell.enhanced}${selected ? " Selected" : ""}`
      : `${card.value} Mana${selected ? ", selected" : ""}`,
  );
  if (spell) {
    button.innerHTML = `<span class="card-kind">ELEMENTAL</span><span class="card-spell-icon">${spell.icon}</span><span class="card-name">${spell.label}</span><span class="spell-effect"><b>BASIC</b> ${spell.basic}</span><span class="spell-effect enhanced"><b>ENHANCED</b> ${spell.enhanced}</span>`;
  } else {
    button.innerHTML = `<span class="card-kind">MANA</span><span class="card-value">${card.value}</span><span class="card-quantity">✦ POINTS</span>`;
  }
  if (selectable) button.addEventListener("click", (event) => onCardClick(card, event.currentTarget.getBoundingClientRect()));
  return button;
}

function makeFlightCard(card, originRect) {
  if (!originRect) return null;
  const actor = makeCard(card, false);
  actor.classList.add("flight-card");
  actor.setAttribute("aria-hidden", "true");
  actor.style.position = "fixed";
  actor.style.left = `${originRect.left}px`;
  actor.style.top = `${originRect.top}px`;
  actor.style.width = `${originRect.width}px`;
  actor.style.height = `${originRect.height}px`;
  actor.style.zIndex = "1000";
  actor.style.pointerEvents = "none";
  document.body.append(actor);
  return actor;
}

async function flyActor(actor, destination, duration = 500) {
  if (!actor || !destination) {
    actor?.remove();
    return;
  }
  const start = actor.getBoundingClientRect();
  const end = destination.getBoundingClientRect();
  const x = end.left + end.width / 2 - (start.left + start.width / 2);
  const y = end.top + end.height / 2 - (start.top + start.height / 2);
  const motion = actor.animate(
    [
      { transform: "translate(0, 0) scale(1) rotate(0deg)" },
      { transform: `translate(${x}px, ${y}px) scale(.72) rotate(4deg)` },
    ],
    { duration, easing: "cubic-bezier(.2,.8,.25,1)", fill: "forwards" },
  );
  await motion.finished;
  return actor;
}

async function animateCardFlight(card, originRect, destination) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const actor = await flyActor(makeFlightCard(card, originRect), destination, 380);
  actor?.remove();
}

function showSpellImpact(target, symbol, className = "") {
  if (!target) return Promise.resolve();
  const rect = target.getBoundingClientRect();
  const marker = document.createElement("span");
  marker.className = `spell-impact ${className}`;
  marker.setAttribute("aria-hidden", "true");
  marker.textContent = symbol;
  marker.style.left = `${rect.left + rect.width / 2}px`;
  marker.style.top = `${rect.top + rect.height / 2}px`;
  document.body.append(marker);
  const pulse = target.animate(
    [
      { filter: "brightness(1)", boxShadow: "0 0 0 rgba(255,255,255,0)" },
      { filter: "brightness(1.7)", boxShadow: "0 0 28px rgba(235,195,102,.72)" },
      { filter: "brightness(1)", boxShadow: "0 0 0 rgba(255,255,255,0)" },
    ],
    { duration: 720, easing: "ease-out" },
  );
  const impact = marker.animate(
    [
      { opacity: 0, transform: "translate(-50%, -40%) scale(.35) rotate(-12deg)" },
      { opacity: 1, transform: "translate(-50%, -70%) scale(1.25) rotate(8deg)", offset: 0.3 },
      { opacity: 0, transform: "translate(-50%, -130%) scale(.75) rotate(18deg)" },
    ],
    { duration: 720, easing: "ease-out" },
  );
  return Promise.all([pulse.finished, impact.finished]).finally(() => marker.remove());
}

async function animateWaterRecovery(origin, destination) {
  if (!origin || !destination) return;
  const start = origin.getBoundingClientRect();
  const end = destination.getBoundingClientRect();
  const marker = document.createElement("span");
  marker.className = "spell-impact water-impact";
  marker.setAttribute("aria-hidden", "true");
  marker.textContent = "💧";
  marker.style.left = `${start.left + start.width / 2}px`;
  marker.style.top = `${start.top + start.height / 2}px`;
  document.body.append(marker);
  const animation = marker.animate(
    [
      { opacity: 0, transform: "translate(-50%, -50%) scale(.5)" },
      {
        opacity: 1,
        transform: `translate(-50%, -50%) translate(${end.left + end.width / 2 - start.left - start.width / 2}px, ${end.top + end.height / 2 - start.top - start.height / 2}px) scale(1.5)`,
        offset: 0.75,
      },
      {
        opacity: 0,
        transform: `translate(-50%, -50%) translate(${end.left + end.width / 2 - start.left - start.width / 2}px, ${end.top + end.height / 2 - start.top - start.height / 2}px) scale(.7)`,
      },
    ],
    { duration: 700, easing: "cubic-bezier(.2,.8,.25,1)" },
  );
  await animation.finished;
  marker.remove();
}

async function animateSpellResolution(spell, originRect, targetIds, enhanced) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const actor = makeFlightCard(spell, originRect);
  try {
    await flyActor(actor, $(".table-center"), 520);
    const targets = targetIds.map((id) => document.querySelector(`[data-player-id="${id}"]`)).filter(Boolean);
    if (spell.element === "fire") {
      await Promise.all(targets.map((target) => showSpellImpact(target, "🔥", "fire-impact")));
    } else if (spell.element === "earth") {
      await showSpellImpact($("#human-altar-area"), "🛡️", "earth-impact");
    } else if (spell.element === "water") {
      await animateWaterRecovery($("#discard-pile"), $("#human-altar"));
    } else if (spell.element === "air") {
      if (targets[0]) await showSpellImpact(targets[0], "⚡", "air-impact");
      await showSpellImpact($("#human-altar"), "💨", "air-impact");
    }
  } finally {
    actor?.remove();
  }
}

async function animateTableActions(actions) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const effects = actions.filter((action) => action.type !== "spell");
  await Promise.all(effects.map(async (action) => {
    if (action.type === "water") {
      const playerId = action.playerIds[0];
      const target = playerId === game.players[0].id
        ? $("#human-altar")
        : document.querySelector(`[data-player-id="${playerId}"] .opponent-altar`);
      await animateWaterRecovery($("#discard-pile"), target);
      return;
    }
    const symbol = action.type === "blocked" ? "🛡️" : action.symbol;
    const affectedPlayerIds = action.type === "fire" ? action.playerIds.slice(1) : action.playerIds;
    await Promise.all(affectedPlayerIds.map((playerId) => {
      const target = playerId === game.players[0].id
        ? $("#human-board")
        : document.querySelector(`[data-player-id="${playerId}"]`);
      return showSpellImpact(target, symbol, `${action.type}-impact`);
    }));
  }));
}

function renderOpponents() {
  const container = $("#opponents");
  container.replaceChildren();
  const selectableTargets = new Set(getHumanSpellTargets().map((player) => player.id));
  for (const player of game.players.slice(1)) {
    const card = document.createElement("article");
    const active = !game.winner && game.currentPlayer === game.players.indexOf(player);
    const selectable = selectableTargets.has(player.id);
    card.className = `opponent${active ? " active" : ""}${selectable ? " targetable" : ""}`;
    card.dataset.playerId = player.id;
    const name = selectable
      ? `<button class="opponent-target" type="button" aria-label="Choose ${player.name} as spell target">${player.name}</button>`
      : `<span>${player.name}</span>`;
    const altar = player.altar.length ? `${player.altar.length} card${player.altar.length === 1 ? "" : "s"} · ${altarPoints(player)} pts` : "Empty";
    const altarCards = player.altar.map((mana) => `<span class="opponent-mana" title="${mana.value} Mana">${mana.value}</span>`).join("");
    card.innerHTML = `<div class="opponent-name">${name}<span class="opponent-status">${selectable ? "SELECT TARGET" : active ? "THINKING" : "OPPONENT"}</span></div><div class="opponent-stats"><span>Vault <b>${score(player)} pts</b></span><span>Altar ${altar}${player.shield ? " · 🛡" : ""}</span></div><div class="opponent-altar" aria-label="${player.name}'s Altar Mana">${altarCards}</div>`;
    if (selectable) {
      card.querySelector(".opponent-target").addEventListener("click", () => {
        void castAndEndTurn(selectedFuelIds.length, player.id);
      });
    }
    container.append(card);
  }
}

function getHumanTargetSpell() {
  if (!game || game.currentPlayer !== 0 || game.phase !== "spell" || game.spellCastThisTurn || game.spellResolutionPending) return null;
  const spell = game.players[0].hand.find((card) => card.id === selectedCardId && card.kind === "spell");
  if (!spell || selectedFuelIds.length === 0) return null;
  if (spell.element === "air" || spell.element === "fire" && selectedFuelIds.length === 1) return spell;
  return null;
}

function getHumanSpellTargets() {
  const spell = getHumanTargetSpell();
  if (!spell) return [];
  return activeOpponents(game.players[0]).filter((player) => spell.element !== "air" || player.altar.length > 0);
}

function getHumanWaterSpell() {
  if (!game || game.currentPlayer !== 0 || game.phase !== "spell" || game.spellCastThisTurn || game.spellResolutionPending) return null;
  const spell = game.players[0].hand.find((card) => card.id === selectedCardId && card.kind === "spell");
  return spell?.element === "water" && selectedFuelIds.length > 0 ? spell : null;
}

function renderWaterReclaim() {
  const spell = getHumanWaterSpell();
  const section = $("#water-reclaim");
  section.classList.toggle("hidden", !spell);
  if (!spell) return;

  const limit = Math.min(selectedFuelIds.length, 2);
  $("#water-reclaim-prompt").textContent =
    `Choose up to ${limit} Mana from the discard pile for your Altar. ${selectedDiscardIds.length} selected.`;
  const choices = game.discard.filter((card) => card.kind === "mana").slice().reverse().map((card) => {
    const selected = selectedDiscardIds.includes(card.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `discard-mana-choice${selected ? " selected" : ""}`;
    button.textContent = `${card.value} Mana`;
    button.setAttribute("aria-label", `${card.value} Mana in discard`);
    button.setAttribute("aria-pressed", String(selected));
    button.disabled = !selected && selectedDiscardIds.length >= limit;
    button.addEventListener("click", () => {
      selectedDiscardIds = selected
        ? selectedDiscardIds.filter((id) => id !== card.id)
        : [...selectedDiscardIds, card.id];
      render();
    });
    return button;
  });
  $("#water-reclaim-cards").replaceChildren(...choices);
}

function renderAltar() {
  const player = game.players[0];
  const container = $("#human-altar");
  container.replaceChildren(...player.altar.map((card) => {
    const chip = document.createElement("span");
    chip.className = "mana-chip";
    chip.textContent = `${card.value} ✦`;
    chip.title = `${card.value} Mana`;
    return chip;
  }));
  $("#altar-hint").textContent = player.altar.length
    ? `${player.altar.length} Mana · ${altarPoints(player)} points — claimed at the start of your next turn.`
    : "Click a Mana card in your hand to stage here.";
  $("#shield-indicator").textContent = player.shield ? `🛡 ${player.shield.enhanced ? "ENHANCED SHIELD" : "SHIELDED"}` : "";
  $("#vault-score").innerHTML = `${score(player)} <small>pts</small>`;
  $("#vault-cards").textContent = `${player.vault.length} card${player.vault.length === 1 ? "" : "s"}`;
}

function renderActions() {
  const player = game.players[0];
  const selectedSpell = player.hand.find((card) => card.id === selectedCardId && card.kind === "spell");
  const selectedFuel = selectedFuelIds.map((id) => player.hand.find((card) => card.id === id)).filter(Boolean);
  controlsElement.replaceChildren();
  const addButton = (label, action, options = {}) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `action-button${options.secondary ? " secondary" : ""}`;
    button.textContent = label;
    button.disabled = Boolean(options.disabled);
    button.addEventListener("click", action);
    controlsElement.append(button);
  };

  if (game.winner) {
    $("#step-number").textContent = "MATCH COMPLETE";
    $("#action-title").textContent = "Game over";
    $("#action-description").textContent = "Start a new game to play again.";
    return;
  }
  if (game.currentPlayer !== 0) {
    $("#step-number").textContent = "OPPONENT TURN";
    $("#action-title").textContent = "Opponents are playing";
    $("#action-description").textContent = "Your turn resumes after all four opponents.";
    return;
  }
  if (game.spellResolutionPending) {
    $("#step-number").textContent = "STEP 3 OF 4";
    $("#action-title").textContent = "Spell resolving";
    $("#action-description").textContent = "The turn will end when the spell effect finishes.";
    return;
  }

  if (game.phase === "stage") {
    $("#step-number").textContent = "STEP 2 OF 4";
    $("#action-title").textContent = "Stage Mana";
    $("#action-description").textContent = manaCards(player).length
      ? "Click a Mana card in your hand to stage it."
      : "No Mana to stage. Continue to your spell step.";
    if (manaCards(player).length === 0) {
      addButton("Continue without Mana", () => {
        game.phase = "spell";
        saveGame();
        render();
      }, { secondary: true });
    }
    return;
  }
  if (game.phase === "spell") {
    $("#step-number").textContent = "STEP 3 OF 4";
    $("#action-title").textContent = "Cast a Spell";
    const targetSpell = getHumanTargetSpell();
    const targetPlayers = targetSpell ? getHumanSpellTargets() : [];
    const waterSpell = selectedSpell?.element === "water";
    const availableDiscardMana = game.discard.filter((card) => card.kind === "mana").length;
    $("#action-description").textContent = game.spellCastThisTurn
      ? "You may cast only 1 Spell each turn."
      : selectedSpell
        ? targetSpell
          ? targetPlayers.length
            ? `Select ${selectedFuel.length === 1 ? "Basic" : "Enhanced"} ${SPELLS[selectedSpell.element].label}, then click an opponent's name to cast.`
            : "No opponent has Mana on their Altar to target."
          : waterSpell
            ? availableDiscardMana
              ? `Select 1 or 2 fuel, then choose up to ${Math.min(selectedFuel.length, 2)} Mana from discard. Basic reclaims 1; Enhanced reclaims up to 2.`
              : "There is no Mana in the discard pile for Water to reclaim."
            : `Select 1 or 2 Mana fuel. ${selectedFuel.length}/2 selected.`
        : "Optional — select a Spell card from your hand.";
    if (!game.spellCastThisTurn && selectedSpell && selectedFuel.length >= 1) {
      if (!targetSpell) {
        if (waterSpell) {
          if (selectedDiscardIds.length >= 1) {
            addButton("Basic · 1 fuel", () => castAndEndTurn(1, null, selectedDiscardIds.slice(0, 1)));
            if (selectedFuel.length >= 2) {
              addButton("Enhanced · 2 fuel", () => castAndEndTurn(2, null, selectedDiscardIds.slice(0, 2)));
            }
          }
        } else {
          addButton("Basic · 1 fuel", () => castAndEndTurn(1));
          if (selectedFuel.length >= 2) addButton("Enhanced · 2 fuel", () => castAndEndTurn(2));
        }
      }
    }
    addButton("Skip spell & end turn", endHumanTurn, { secondary: true });
    return;
  }
  $("#step-number").textContent = "STEP 4 OF 4";
  $("#action-title").textContent = "Draw to 5";
  $("#action-description").textContent = "Your hand refills at the end of your turn.";
  addButton("End turn", endHumanTurn);
}

function renderActivity() {
  const activity = game.activity ?? [];
  const section = $("#table-activity");
  const recent = activity.slice(0, 2);
  const effect = recent.find((action) => ["blocked", "fire", "air", "water", "shield"].includes(action.type));
  const visibleActions = effect && recent[0] !== effect
    ? [effect, ...recent.filter((action) => action !== effect)]
    : recent;
  section.classList.toggle("has-activity", activity.length > 0);
  $("#activity-list").replaceChildren(...visibleActions.map((action) => {
    const item = document.createElement("li");
    const icon = document.createElement("span");
    icon.className = "activity-icon";
    icon.textContent = action.symbol ?? "✦";
    const message = document.createElement("span");
    message.textContent = action.message;
    item.append(icon, message);
    return item;
  }));
}

async function castAndEndTurn(fuelCount, targetId = null, discardCardIds = []) {
  if (resolvingSpell || game.spellResolutionPending) return;
  const player = game.players[0];
  const spell = player.hand.find((card) => card.id === selectedCardId && card.kind === "spell");
  const fuel = selectedFuelIds.slice(0, fuelCount);
  if (!spell || fuel.length !== fuelCount) return;
  const needsTarget = spell.element === "air" || spell.element === "fire" && fuelCount === 1;
  if (needsTarget && !getHumanSpellTargets().some((target) => target.id === targetId)) return;
  if (spell.element === "water" &&
      (!discardCardIds.length || discardCardIds.length > fuelCount ||
        discardCardIds.some((id) => !game.discard.some((card) => card.id === id && card.kind === "mana")))) return;
  const originRect = document.querySelector(`[data-card-id="${spell.id}"]`)?.getBoundingClientRect();
  const affectedTargets = spell.element === "fire" && fuelCount === 2
    ? activeOpponents(player).map((other) => other.id)
    : targetId
      ? [targetId]
      : [];
  if (!castSpell(player, spell.id, fuel, targetId, discardCardIds)) return;
  resolvingSpell = true;
  game.spellResolutionPending = true;
  selectedCardId = null;
  selectedFuelIds = [];
  selectedDiscardIds = [];
  saveGame();
  render();
  try {
    await animateSpellResolution(spell, originRect, affectedTargets, fuelCount === 2);
  } catch (error) {
    console.error("Spell effect animation failed.", error);
  } finally {
    resolvingSpell = false;
    if (game.spellResolutionPending) finishTurn(player);
  }
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
  $("#turn-label").textContent = game.winner
    ? `MATCH COMPLETE · TURN ${game.turn}`
    : game.currentPlayer === 0 ? `YOUR TURN · TURN ${game.turn}` : `${game.players[game.currentPlayer].name.toUpperCase()} IS PLAYING`;
  $("#phase-title").textContent = game.winner
    ? `${game.winner.playerName} wins by the ${game.winner.path} path.`
    : game.currentPlayer === 0
      ? game.spellResolutionPending ? "Your spell is resolving." : game.phase === "stage" ? "Your Altar awaits." : "Choose your next move."
      : `${game.players[game.currentPlayer].name} is taking a turn…`;
  $("#deck-count").textContent = String(game.deck.length);
  $("#discard-count").textContent = String(game.discard.length);
  $("#discard-top").textContent = game.discard.length ? cardDescription(game.discard.at(-1)) : "empty";
  $("#discard-pile").classList.toggle("has-cards", game.discard.length > 0);
  $("#round-count").textContent = String(game.turn);
  renderOpponents();
  renderWaterReclaim();
  renderActivity();
  renderAltar();
  $("#hand-count").textContent = `${game.players[0].hand.length} card${game.players[0].hand.length === 1 ? "" : "s"}`;
  handElement.replaceChildren(...game.players[0].hand.map((card) => makeCard(
    card,
    game.currentPlayer === 0 && !game.winner && !game.spellResolutionPending &&
      !(game.phase === "spell" && game.spellCastThisTurn),
  )));
  $("#selection-hint").textContent = game.currentPlayer !== 0
    ? "Waiting for opponents…"
    : game.spellResolutionPending
      ? "Your spell is resolving…"
    : game.phase === "stage"
      ? manaCards(game.players[0]).length
        ? "Click a Mana card to stage."
        : "No Mana available to stage."
      : selectedCardId
        ? "Select up to 2 Mana cards as fuel."
        : "Select a Spell to cast, or skip.";
  $("#spell-fuel-stat").textContent =
    `No-fuel ${game.spellFuelMisses}/${game.humanTurns} · Low-Mana redraws ${game.humanLowManaRedraws} you / ${game.opponentLowManaRedraws} AI`;
  renderActions();
  $("#log-count").textContent = String(game.log.length);
  $("#log-list").replaceChildren(...game.log.map((entry) => {
    const item = document.createElement("li");
    item.textContent = entry;
    return item;
  }));
}

function cardDescription(card) {
  return card.kind === "mana" ? `${card.value} Mana` : `${SPELLS[card.element].label} spell`;
}

function saveGame() {
  if (!game) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(game));
  } catch (error) {
    console.error("Could not save Elemental Altars game.", error);
    $("#save-note").textContent = "Auto-save is unavailable in this browser session.";
  }
}

function loadGame() {
  try {
    const saved = localStorage.getItem(SAVE_KEY);
    if (!saved) return false;
    const parsed = JSON.parse(saved);
    if (!parsed || !Array.isArray(parsed.players) || parsed.players.length !== 5 ||
        !Array.isArray(parsed.deck) || !Array.isArray(parsed.discard) || !Number.isInteger(parsed.currentPlayer) ||
        parsed.currentPlayer < 0 || parsed.currentPlayer > 4 || !Array.isArray(parsed.log)) {
      throw new Error("Saved game has an invalid shape.");
    }
    game = parsed;
    game.humanTurns = Number.isInteger(game.humanTurns) ? game.humanTurns : 0;
    game.spellFuelMisses = Number.isInteger(game.spellFuelMisses) ? game.spellFuelMisses : 0;
    game.humanLowManaRedraws = Number.isInteger(game.humanLowManaRedraws) ? game.humanLowManaRedraws : 0;
    game.opponentLowManaRedraws = Number.isInteger(game.opponentLowManaRedraws) ? game.opponentLowManaRedraws : 0;
    game.spellResolutionPending = Boolean(game.spellResolutionPending);
    game.activity = Array.isArray(game.activity) ? game.activity : [];
    return true;
  } catch (error) {
    console.error("Could not restore Elemental Altars game.", error);
    localStorage.removeItem(SAVE_KEY);
    return false;
  }
}

function showResult() {
  if (!game?.winner) return;
  const won = game.winner.playerId === game.players[0].id;
  $("#result-eyebrow").textContent = won ? "VICTORY" : "GAME OVER";
  $("#result-title").textContent = won ? "Well played." : `${game.winner.playerName} wins.`;
  $("#result-copy").textContent = won
    ? `You claimed the ${game.winner.path} path with ${score(game.players[0])} Vault points and ${game.players[0].vault.length} cards.`
    : `${game.winner.playerName} reached the ${game.winner.path} path. Start a new game and try a different strategy.`;
  $("#result-dialog").showModal();
}

$("#start-button").addEventListener("click", newGame);
$("#new-game-button").addEventListener("click", () => {
  if (window.confirm("Start a new game? Your current playtest will be replaced.")) newGame();
});
$("#play-again-button").addEventListener("click", () => {
  $("#result-dialog").close();
  newGame();
});
$("#rules-button").addEventListener("click", () => $("#rules-dialog").showModal());
document.querySelectorAll(".close-dialog").forEach((button) => button.addEventListener("click", () => $("#rules-dialog").close()));
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.error("Service worker registration failed.", error);
    });
  });
}

if (loadGame()) {
  render();
  if (game.winner) showResult();
  else if ((game.spellResolutionPending || game.spellCastThisTurn) && game.currentPlayer === 0) finishTurn(game.players[0]);
  else if (game.currentPlayer !== 0) runAITurns();
} else {
  render();
}
