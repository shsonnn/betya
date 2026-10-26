const MIN_PLAYERS = 2;
const MAX_PLAYERS = 12;
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const ROLL_DURATION = REDUCED_MOTION ? 450 : 1800;

const playersElement = document.querySelector("#players");
const gameTitle = document.querySelector("#game-title");
const dieOne = document.querySelector("#die-one");
const dieTwo = document.querySelector("#die-two");
const dieOneRig = dieOne.closest(".die-rig");
const dieTwoRig = dieTwo.closest(".die-rig");
const turnLabel = document.querySelector("#turn-label");
const rollButton = document.querySelector("#roll-button");
const buttonLabel = document.querySelector("#button-label");
const hint = document.querySelector("#hint");
const resultStage = document.querySelector("#dice-result-stage");
const playerCountElement = document.querySelector("#player-count");
const decreasePlayersButton = document.querySelector("#decrease-players");
const increasePlayersButton = document.querySelector("#increase-players");
const homeButton = document.querySelector("#dice-home");

let playerCount = 6;
let currentPlayer = 0;
let playerNames = Array(playerCount).fill("");
let results = Array(playerCount).fill(null);
let gameFinished = false;
let isRolling = false;
let remoteRevision = -1;
let remoteRollTimer = null;
let nameSyncTimer = null;
let localSetupDirty = false;

function inRoom() {
  return window.BetyaRoom?.session()?.backend === "room-v2";
}

function isGuest() {
  return Boolean(window.BetyaRoom?.session()) && !window.BetyaRoom.isHost();
}

function sendDiceSetup() {
  if (!inRoom() || isGuest()) return;
  localSetupDirty = true;
  rollButton.disabled = true;
  window.clearTimeout(nameSyncTimer);
  nameSyncTimer = window.setTimeout(() => {
    window.BetyaRoom.send("game.configure", { player_count: playerCount, names: playerNames });
  }, 220);
}

function getPlayerName(index) {
  return playerNames[index].trim() || `${index + 1}번`;
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function createPlayerCards() {
  playersElement.innerHTML = results.map((result, index) => `
    <li class="player${index === currentPlayer ? " is-current" : ""}" data-player="${index}">
      <input class="player-name" data-name-index="${index}" value="${escapeHtml(playerNames[index])}"
        placeholder="이름을 입력하세요" aria-label="${index + 1}번 참가자 이름" maxlength="8" spellcheck="false" ${isGuest() ? "disabled" : ""} />
      <strong>${result ? result.lastDigit : "--"}</strong>
    </li>`).join("");

  document.querySelectorAll(".player-name").forEach((input) => {
    input.addEventListener("input", handleNameChange);
    input.addEventListener("focus", (event) => event.currentTarget.select());
  });
}

function handleNameChange(event) {
  if (isGuest()) return;
  const index = Number(event.currentTarget.dataset.nameIndex);
  playerNames[index] = event.currentTarget.value;
  if (inRoom()) sendDiceSetup();
  if (gameFinished) finishGame();
  else if (index === currentPlayer) {
    turnLabel.textContent = `${getPlayerName(currentPlayer)} 차례`;
    buttonLabel.textContent = "굴리기";
  }
}

function chooseDiceResult() {
  const completedResults = results.filter(Boolean);
  const digitCounts = new Map();
  completedResults.forEach(({ lastDigit }) => digitCounts.set(lastDigit, (digitCounts.get(lastDigit) || 0) + 1));
  const candidates = [];
  for (let first = 1; first <= 6; first += 1) {
    for (let second = 1; second <= 6; second += 1) {
      const sum = first + second;
      const lastDigit = sum % 10;
      if (lastDigit === 0 && digitCounts.has(0)) continue;
      candidates.push({ first, second, sum, lastDigit });
    }
  }
  const unused = candidates.filter(({ lastDigit }) => !digitCounts.has(lastDigit));
  if (unused.length) return unused[Math.floor(Math.random() * unused.length)];
  const minimumCount = Math.min(...candidates.map(({ lastDigit }) => digitCounts.get(lastDigit) || 0));
  const leastUsed = candidates.filter(({ lastDigit }) => (digitCounts.get(lastDigit) || 0) === minimumCount);
  return leastUsed[Math.floor(Math.random() * leastUsed.length)];
}

function renderPipFace(value) {
  return `<span class="slot-face slot-face--${value}">${Array.from({ length: value }, () => '<i class="pip"></i>').join("")}</span>`;
}

function createDiceFaces(element) {
  element.innerHTML = `<span class="die-window" aria-hidden="true"><span class="die-reel">${renderPipFace(1)}</span></span>`;
}

function spinDie(element, finalValue, direction = "up") {
  const reel = element.querySelector(".die-reel");
  const spinCount = REDUCED_MOTION ? 7 : 18;
  const passing = Array.from({ length: spinCount }, (_, index) => ((index + finalValue + (direction === "down" ? 2 : 0)) % 6) + 1);
  const values = direction === "down" ? [finalValue, ...passing] : [...passing, finalValue];
  const distance = values.length - 1;
  reel.innerHTML = values.map(renderPipFace).join("");
  reel.style.transition = "none";
  reel.style.transform = direction === "down" ? `translateY(-${distance * 100}%)` : "translateY(0)";
  element.classList.add("is-spinning");
  void reel.offsetHeight;
  reel.style.transition = `transform ${ROLL_DURATION}ms cubic-bezier(0.08, 0.68, 0.08, 1)`;
  reel.style.transform = direction === "down" ? "translateY(0)" : `translateY(-${distance * 100}%)`;
}

function setDieValue(element, value, announce = true) {
  element.dataset.value = value;
  element.classList.remove("is-spinning");
  const reel = element.querySelector(".die-reel");
  reel.style.transition = "none";
  reel.style.transform = "translateY(0)";
  reel.innerHTML = renderPipFace(value);
  if (announce) element.setAttribute("aria-label", `${element === dieOne ? "첫" : "두"} 번째 주사위: ${value}`);
}

function setInteractionLocked(locked) {
  isRolling = locked;
  rollButton.hidden = isGuest();
  rollButton.disabled = locked || isGuest() || (inRoom() && localSetupDirty);
  decreasePlayersButton.disabled = locked || isGuest() || playerCount === MIN_PLAYERS;
  increasePlayersButton.disabled = locked || isGuest() || playerCount === MAX_PLAYERS;
  document.querySelectorAll(".player-name").forEach((input) => { input.disabled = locked || isGuest(); });
}

function updatePlayerCards(losers = []) {
  document.querySelectorAll(".player").forEach((card, index) => {
    card.classList.toggle("is-current", !gameFinished && index === currentPlayer);
    card.classList.toggle("is-done", results[index] !== null);
    card.classList.toggle("is-loser", losers.includes(index));
    card.querySelector("strong").textContent = results[index]?.lastDigit ?? "--";
  });
}

function finishGame() {
  gameFinished = true;
  const lowest = Math.min(...results.map((result) => result.lastDigit));
  const losers = results.map((result, index) => result.lastDigit === lowest ? index : -1).filter((index) => index !== -1);
  const loserNames = losers.map((index) => getPlayerName(index)).join(", ");
  updatePlayerCards(losers);
  resultStage.innerHTML = `
    <span class="result-kicker">짠! 오늘의 당첨 🎉</span>
    <strong>${escapeHtml(loserNames)}</strong>
    <span class="result-digit">끝자리 ${lowest}</span>
    <p>${losers.length > 1 ? "끝자리가 같아서 공동 당첨이에요" : "끝자리가 가장 작은 사람이 당첨이에요"}</p>`;
  resultStage.hidden = false;
  document.body.classList.add("is-finished");
  turnLabel.textContent = `${loserNames} 당첨`;
  turnLabel.classList.add("is-result");
  buttonLabel.textContent = "다시 하기";
  hint.textContent = losers.length > 1 ? "끝자리가 같아서 공동 당첨이에요" : "끝자리가 가장 작은 사람이 당첨이에요";
}

function resetGame() {
  currentPlayer = 0;
  results = Array(playerCount).fill(null);
  gameFinished = false;
  gameTitle.textContent = "0의 주사위";
  document.body.classList.remove("is-finished");
  resultStage.hidden = true;
  resultStage.replaceChildren();
  dieOneRig.classList.remove("is-rolling");
  dieTwoRig.classList.remove("is-rolling");
  setDieValue(dieOne, 1);
  setDieValue(dieTwo, 1);
  turnLabel.textContent = `${getPlayerName(0)} 차례`;
  turnLabel.classList.remove("is-result");
  buttonLabel.textContent = "굴리기";
  hint.textContent = `${getPlayerName(0)} 차례 · 슬롯이 멈춘 점의 개수가 결과예요`;
  updatePlayerCards();
  setInteractionLocked(false);
}

function changePlayerCount(amount) {
  if (isRolling || isGuest()) return;
  const nextCount = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, playerCount + amount));
  if (nextCount === playerCount) return;
  if (nextCount > playerCount) {
    for (let index = playerCount; index < nextCount; index += 1) playerNames.push("");
  } else playerNames = playerNames.slice(0, nextCount);
  playerCount = nextCount;
  playerCountElement.textContent = `${playerCount}명`;
  decreasePlayersButton.disabled = playerCount === MIN_PLAYERS;
  increasePlayersButton.disabled = playerCount === MAX_PLAYERS;
  results = Array(playerCount).fill(null);
  currentPlayer = 0;
  createPlayerCards();
  resetGame();
  sendDiceSetup();
}

function rollDice() {
  if (inRoom()) {
    if (isGuest() || isRolling) return;
    const sent = window.BetyaRoom.send(gameFinished ? "game.reset" : "game.roll");
    if (!sent) hint.textContent = "방 연결을 확인한 뒤 다시 시도해주세요.";
    return;
  }
  if (isRolling) return;
  if (gameFinished) { resetGame(); return; }
  setInteractionLocked(true);
  buttonLabel.textContent = "굴러가는 중…";
  hint.textContent = "빠르게 흐르는 주사위 면이 멈추면 결과가 공개돼요";
  dieOneRig.classList.remove("is-rolling");
  dieTwoRig.classList.remove("is-rolling");
  void dieOneRig.offsetWidth;
  dieOneRig.classList.add("is-rolling");
  dieTwoRig.classList.add("is-rolling");
  const { first, second, sum, lastDigit } = chooseDiceResult();
  spinDie(dieOne, first, "up");
  spinDie(dieTwo, second, "down");
  window.setTimeout(() => {
    results[currentPlayer] = { first, second, sum, lastDigit };
    setDieValue(dieOne, first);
    setDieValue(dieTwo, second);
    dieOneRig.classList.remove("is-rolling");
    dieTwoRig.classList.remove("is-rolling");
    if (currentPlayer === playerCount - 1) finishGame();
    else {
      currentPlayer += 1;
      updatePlayerCards();
      turnLabel.textContent = `${getPlayerName(currentPlayer)} 차례`;
      buttonLabel.textContent = "굴리기";
      hint.textContent = `${getPlayerName(currentPlayer)} 차례 · 휴대폰을 다음 사람에게 넘겨주세요`;
    }
    setInteractionLocked(false);
  }, ROLL_DURATION);
}

function applyRemoteDice(game, animate = false) {
  if (!game || game.type !== "dice") return;
  const previousRevision = remoteRevision;
  if (game.revision < previousRevision) return;
  if (!isGuest() && localSetupDirty && game.status === "idle") {
    const namesMatch = game.player_count === playerCount
      && Array.isArray(game.names)
      && game.names.every((name, index) => name === playerNames[index]);
    if (!namesMatch) {
      remoteRevision = game.revision;
      sendDiceSetup();
      return;
    }
    localSetupDirty = false;
  }
  remoteRevision = game.revision;
  window.clearTimeout(remoteRollTimer);
  const count = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Number(game.player_count) || 6));
  const names = Array.isArray(game.names) ? game.names.slice(0, count) : [];
  while (names.length < count) names.push("");
  const keepHostInput = !animate && !isGuest() && document.activeElement?.classList.contains("player-name")
    && count === playerCount && game.status === "idle";
  playerCount = count;
  playerNames = names;
  playerCountElement.textContent = `${count}명`;
  const reveal = () => {
    results = Array.isArray(game.rolls) ? game.rolls.slice(0, count) : Array(count).fill(null);
    while (results.length < count) results.push(null);
    currentPlayer = Math.min(count - 1, Number(game.current_index) || 0);
    gameFinished = game.status === "complete";
    if (!keepHostInput) createPlayerCards();
    if (gameFinished) {
      finishGame();
    } else {
      document.body.classList.remove("is-finished");
      resultStage.hidden = true;
      resultStage.replaceChildren();
      turnLabel.classList.remove("is-result");
      turnLabel.textContent = `${getPlayerName(currentPlayer)} 차례`;
      buttonLabel.textContent = "굴리기";
      hint.textContent = `${getPlayerName(currentPlayer)} 차례 · 슬롯이 멈춘 점의 개수가 결과예요`;
      updatePlayerCards();
    }
    const last = game.last_roll;
    if (last) {
      setDieValue(dieOne, last.first);
      setDieValue(dieTwo, last.second);
    } else {
      setDieValue(dieOne, 1);
      setDieValue(dieTwo, 1);
    }
    dieOneRig.classList.remove("is-rolling");
    dieTwoRig.classList.remove("is-rolling");
    setInteractionLocked(false);
  };
  if (animate && game.last_roll && game.revision > previousRevision) {
    if (!keepHostInput) createPlayerCards();
    currentPlayer = game.last_roll.index;
    updatePlayerCards();
    turnLabel.textContent = `${getPlayerName(currentPlayer)} 굴리는 중…`;
    buttonLabel.textContent = "굴러가는 중…";
    hint.textContent = "주사위 면이 멈추면 결과가 공개돼요";
    setInteractionLocked(true);
    dieOneRig.classList.add("is-rolling");
    dieTwoRig.classList.add("is-rolling");
    spinDie(dieOne, game.last_roll.first, "up");
    spinDie(dieTwo, game.last_roll.second, "down");
    remoteRollTimer = window.setTimeout(reveal, Math.max(0, Number(game.animation_until_ms) - Date.now()));
  } else reveal();
}

createPlayerCards();
rollButton.hidden = isGuest();
createDiceFaces(dieOne);
createDiceFaces(dieTwo);
setDieValue(dieOne, 1);
setDieValue(dieTwo, 1);
rollButton.addEventListener("click", rollDice);
decreasePlayersButton.addEventListener("click", () => changePlayerCount(-1));
increasePlayersButton.addEventListener("click", () => changePlayerCount(1));
homeButton.addEventListener("click", () => {
  window.BetyaRoom?.leave();
});
document.addEventListener("betya-game", (event) => {
  if (!inRoom()) return;
  const detail = event.detail;
  const game = detail?.payload?.game;
  const pendingRoll = detail?.type === "game.snapshot" && game?.last_roll && game.animation_until_ms > Date.now();
  applyRemoteDice(game, detail?.type === "game.rolled" || pendingRoll);
});
if (inRoom()) {
  const game = window.BetyaRoom.state()?.game;
  if (game) applyRemoteDice(game);
  else setInteractionLocked(true);
}
