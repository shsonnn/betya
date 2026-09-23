const MIN_PLAYERS = 2;
const MAX_PLAYERS = 12;
const ROLL_DURATION = 470;

const playersElement = document.querySelector("#players");
const dieOne = document.querySelector("#die-one");
const dieTwo = document.querySelector("#die-two");
const turnLabel = document.querySelector("#turn-label");
const scoreElement = document.querySelector("#score");
const sumElement = document.querySelector("#sum");
const lastDigitElement = document.querySelector("#last-digit");
const rollButton = document.querySelector("#roll-button");
const buttonLabel = document.querySelector("#button-label");
const hint = document.querySelector("#hint");
const playerCountElement = document.querySelector("#player-count");
const decreasePlayersButton = document.querySelector("#decrease-players");
const increasePlayersButton = document.querySelector("#increase-players");

let playerCount = 6;
let currentPlayer = 0;
let playerNames = Array.from({ length: playerCount }, (_, index) => `${index + 1}번`);
let results = Array(playerCount).fill(null);
let gameFinished = false;

function getPlayerName(index) {
  return playerNames[index].trim() || `${index + 1}번`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function createPlayerCards() {
  playersElement.innerHTML = results
    .map(
      (result, index) => `
        <li class="player${index === currentPlayer ? " is-current" : ""}" data-player="${index}">
          <input
            class="player-name"
            data-name-index="${index}"
            value="${escapeHtml(playerNames[index])}"
            aria-label="${index + 1}번 참가자 이름"
            maxlength="8"
            spellcheck="false"
          />
          <strong>${result ? result.lastDigit : "—"}</strong>
        </li>`,
    )
    .join("");

  document.querySelectorAll(".player-name").forEach((input) => {
    input.addEventListener("input", handleNameChange);
    input.addEventListener("focus", (event) => event.currentTarget.select());
  });
}

function handleNameChange(event) {
  const index = Number(event.currentTarget.dataset.nameIndex);
  playerNames[index] = event.currentTarget.value;

  if (gameFinished) {
    finishGame();
  } else if (index === currentPlayer) {
    turnLabel.textContent = `${getPlayerName(currentPlayer)} 차례`;
    buttonLabel.textContent = `${getPlayerName(currentPlayer)} 굴리기`;
  }
}

function randomDie() {
  return Math.floor(Math.random() * 6) + 1;
}

function setDieValue(element, value) {
  element.dataset.value = value;
  element.setAttribute("aria-label", `${element === dieOne ? "첫" : "두"} 번째 주사위: ${value}`);
}

function updatePlayerCards(losers = []) {
  document.querySelectorAll(".player").forEach((card, index) => {
    card.classList.toggle("is-current", !gameFinished && index === currentPlayer);
    card.classList.toggle("is-done", results[index] !== null);
    card.classList.toggle("is-loser", losers.includes(index));
    card.querySelector("strong").textContent = results[index]?.lastDigit ?? "—";
  });
}

function finishGame() {
  gameFinished = true;
  const lowest = Math.min(...results.map((result) => result.lastDigit));
  const losers = results
    .map((result, index) => (result.lastDigit === lowest ? index : -1))
    .filter((index) => index !== -1);
  const loserNames = losers.map((index) => getPlayerName(index)).join(", ");

  updatePlayerCards(losers);
  turnLabel.textContent = `🎯 ${loserNames} 벌칙!`;
  turnLabel.classList.add("is-result");
  buttonLabel.textContent = "한 판 더";
  hint.textContent = losers.length > 1 ? "끝자리가 같아서 공동 당첨이에요" : "끝자리가 가장 작은 사람이 당첨이에요";
}

function resetGame() {
  currentPlayer = 0;
  results = Array(playerCount).fill(null);
  gameFinished = false;
  setDieValue(dieOne, 1);
  setDieValue(dieTwo, 1);
  scoreElement.hidden = true;
  turnLabel.textContent = `${getPlayerName(0)} 차례`;
  turnLabel.classList.remove("is-result");
  buttonLabel.textContent = `${getPlayerName(0)} 굴리기`;
  hint.textContent = "버튼을 눌러 두 주사위를 한 번에 굴려요";
  updatePlayerCards();
}

function changePlayerCount(amount) {
  const nextCount = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, playerCount + amount));
  if (nextCount === playerCount) return;

  if (nextCount > playerCount) {
    for (let index = playerCount; index < nextCount; index += 1) {
      playerNames.push(`${index + 1}번`);
    }
  } else {
    playerNames = playerNames.slice(0, nextCount);
  }

  playerCount = nextCount;
  playerCountElement.textContent = `${playerCount}명`;
  decreasePlayersButton.disabled = playerCount === MIN_PLAYERS;
  increasePlayersButton.disabled = playerCount === MAX_PLAYERS;
  results = Array(playerCount).fill(null);
  currentPlayer = 0;
  createPlayerCards();
  resetGame();
}

function rollDice() {
  if (gameFinished) {
    resetGame();
    return;
  }

  rollButton.disabled = true;
  scoreElement.hidden = true;
  dieOne.classList.remove("is-rolling");
  dieTwo.classList.remove("is-rolling");
  void dieOne.offsetWidth;
  dieOne.classList.add("is-rolling");
  dieTwo.classList.add("is-rolling");

  const first = randomDie();
  const second = randomDie();

  window.setTimeout(() => {
    const sum = first + second;
    const lastDigit = sum % 10;
    results[currentPlayer] = { first, second, sum, lastDigit };

    setDieValue(dieOne, first);
    setDieValue(dieTwo, second);
    sumElement.textContent = sum;
    lastDigitElement.textContent = lastDigit;
    scoreElement.hidden = false;
    dieOne.classList.remove("is-rolling");
    dieTwo.classList.remove("is-rolling");

    if (currentPlayer === playerCount - 1) {
      finishGame();
    } else {
      currentPlayer += 1;
      updatePlayerCards();
      turnLabel.textContent = `${getPlayerName(currentPlayer)} 차례`;
      buttonLabel.textContent = `${getPlayerName(currentPlayer)} 굴리기`;
      hint.textContent = "휴대폰을 다음 사람에게 넘겨주세요";
    }

    rollButton.disabled = false;
  }, ROLL_DURATION);
}

createPlayerCards();
setDieValue(dieOne, 1);
setDieValue(dieTwo, 1);
rollButton.addEventListener("click", rollDice);
decreasePlayersButton.addEventListener("click", () => changePlayerCount(-1));
increasePlayersButton.addEventListener("click", () => changePlayerCount(1));
