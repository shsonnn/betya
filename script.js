const MIN_PLAYERS = 2;
const MAX_PLAYERS = 12;
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const ROLL_DURATION = REDUCED_MOTION ? 450 : 1800;
const PIP_LAYOUTS = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
  6: [[0.26, 0.22], [0.74, 0.22], [0.26, 0.5], [0.74, 0.5], [0.26, 0.78], [0.74, 0.78]],
};
const SIDE_VALUES = {
  1: [2, 3],
  2: [6, 3],
  3: [2, 6],
  4: [2, 1],
  5: [1, 3],
  6: [5, 3],
};

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
const playerCountElement = document.querySelector("#player-count");
const decreasePlayersButton = document.querySelector("#decrease-players");
const increasePlayersButton = document.querySelector("#increase-players");

let playerCount = 6;
let currentPlayer = 0;
let playerNames = Array(playerCount).fill("");
let results = Array(playerCount).fill(null);
let gameFinished = false;
let isRolling = false;

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
            placeholder="이름을 입력하세요"
            aria-label="${index + 1}번 참가자 이름"
            maxlength="8"
            spellcheck="false"
          />
          <strong>${result ? result.lastDigit : "--"}</strong>
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
    buttonLabel.textContent = "굴리기";
  }
}

function chooseDiceResult() {
  const completedResults = results.filter(Boolean);
  const digitCounts = new Map();
  completedResults.forEach(({ lastDigit }) => {
    digitCounts.set(lastDigit, (digitCounts.get(lastDigit) || 0) + 1);
  });

  const candidates = [];
  for (let first = 1; first <= 6; first += 1) {
    for (let second = 1; second <= 6; second += 1) {
      const sum = first + second;
      const lastDigit = sum % 10;

      // 끝자리 0은 한 게임에서 두 번 이상 나오지 않는다.
      if (lastDigit === 0 && digitCounts.has(0)) continue;
      candidates.push({ first, second, sum, lastDigit });
    }
  }

  const unusedCandidates = candidates.filter(({ lastDigit }) => !digitCounts.has(lastDigit));
  if (unusedCandidates.length > 0) {
    return unusedCandidates[Math.floor(Math.random() * unusedCandidates.length)];
  }

  // 모든 사용 가능한 끝자리가 한 번씩 나온 뒤에는 가장 적게 나온 숫자만 후보로 삼는다.
  const minimumCount = Math.min(...candidates.map(({ lastDigit }) => digitCounts.get(lastDigit) || 0));
  const leastUsedCandidates = candidates.filter(
    ({ lastDigit }) => (digitCounts.get(lastDigit) || 0) === minimumCount,
  );
  return leastUsedCandidates[Math.floor(Math.random() * leastUsedCandidates.length)];
}

function createDiceFaces(element) {
  element.innerHTML = `
    <span class="die-window" aria-hidden="true">
      <span class="die-reel">${renderPipFace(1)}</span>
    </span>`;
}

function renderPipFace(value) {
  return `
    <span class="slot-face slot-face--${value}">
      ${Array.from({ length: value }, () => '<i class="pip"></i>').join("")}
    </span>`;
}

function spinDie(element, finalValue, direction = "up") {
  const reel = element.querySelector(".die-reel");
  const spinCount = REDUCED_MOTION ? 7 : 18;
  const passingValues = Array.from(
    { length: spinCount },
    (_, index) => ((index + finalValue + (direction === "down" ? 2 : 0)) % 6) + 1,
  );
  const values = direction === "down"
    ? [finalValue, ...passingValues]
    : [...passingValues, finalValue];
  const distance = values.length - 1;

  reel.innerHTML = values.map(renderPipFace).join("");
  reel.style.transition = "none";
  reel.style.transform = direction === "down" ? `translateY(-${distance * 100}%)` : "translateY(0)";
  element.classList.add("is-spinning");
  void reel.offsetHeight;

  reel.style.transition = `transform ${ROLL_DURATION}ms cubic-bezier(0.08, 0.68, 0.08, 1)`;
  reel.style.transform = direction === "down" ? "translateY(0)" : `translateY(-${distance * 100}%)`;
}

function roundedPolygon(context, points, radius = 0.16) {
  const mid = (a, b) => ({ x: a.x + (b.x - a.x) * radius, y: a.y + (b.y - a.y) * radius });
  const last = points.at(-1);
  context.beginPath();
  context.moveTo(...Object.values(mid(last, points[0])));
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    const before = mid(point, points[(index - 1 + points.length) % points.length]);
    const after = mid(point, next);
    context.lineTo(before.x, before.y);
    context.quadraticCurveTo(point.x, point.y, after.x, after.y);
  });
  context.closePath();
}

function drawClayTexture(context, points, seed, density = 130) {
  let state = seed >>> 0;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  context.save();
  roundedPolygon(context, points, 0.24);
  context.clip();

  for (let index = 0; index < density; index += 1) {
    const x = minX + random() * (maxX - minX);
    const y = minY + random() * (maxY - minY);
    const radius = 0.35 + random() * 1.25;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = random() > 0.48
      ? `rgba(255, 253, 244, ${0.025 + random() * 0.07})`
      : `rgba(102, 93, 78, ${0.018 + random() * 0.045})`;
    context.fill();
  }

  for (let index = 0; index < 9; index += 1) {
    const x = minX + random() * (maxX - minX);
    const y = minY + random() * (maxY - minY);
    context.beginPath();
    context.ellipse(x, y, 8 + random() * 18, 2 + random() * 5, random() * Math.PI, 0, Math.PI * 2);
    context.strokeStyle = `rgba(110, 100, 83, ${0.012 + random() * 0.024})`;
    context.lineWidth = 1 + random();
    context.stroke();
  }
  context.restore();
}

function drawProjectedPips(context, quad, value, options = {}) {
  const { alpha = 1, radiusX = 8.5, radiusY = 6.5, accent = false } = options;
  context.save();
  context.globalAlpha = alpha;
  PIP_LAYOUTS[value].forEach(([u, v]) => {
    const weights = [(1 - u) * (1 - v), u * (1 - v), u * v, (1 - u) * v];
    const x = quad.reduce((sum, point, index) => sum + point.x * weights[index], 0);
    const y = quad.reduce((sum, point, index) => sum + point.y * weights[index], 0);
    context.beginPath();
    context.ellipse(x, y + 0.7, radiusX + 1.7, radiusY + 1.7, 0, 0, Math.PI * 2);
    context.fillStyle = "rgba(255, 253, 245, 0.34)";
    context.fill();

    const pipGradient = context.createRadialGradient(x - 1.5, y - 1.4, 0.5, x, y, Math.max(radiusX, radiusY));
    pipGradient.addColorStop(0, "#5a554c");
    pipGradient.addColorStop(0.52, "#343129");
    pipGradient.addColorStop(1, "#211f1a");
    context.beginPath();
    context.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
    context.fillStyle = pipGradient;
    context.shadowColor = "rgba(54, 48, 39, 0.26)";
    context.shadowBlur = 2.5;
    context.shadowOffsetY = 1.5;
    context.fill();
  });
  context.restore();
}

function drawClayDie(element, value) {
  const canvas = element.querySelector(".die-canvas");
  const context = canvas.getContext("2d");
  const accent = false;
  const top = [{ x: 140, y: 18 }, { x: 246, y: 76 }, { x: 140, y: 136 }, { x: 34, y: 76 }];
  const left = [top[3], top[2], { x: 140, y: 226 }, { x: 43, y: 169 }];
  const right = [top[2], top[1], { x: 237, y: 169 }, { x: 140, y: 226 }];

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.shadowColor = "rgba(71, 63, 51, 0.22)";
  context.shadowBlur = 14;
  context.shadowOffsetY = 8;

  const leftGradient = context.createLinearGradient(35, 80, 145, 210);
  leftGradient.addColorStop(0, "#ddd8cc");
  leftGradient.addColorStop(0.58, "#ccc5b7");
  leftGradient.addColorStop(1, "#b9b1a2");
  roundedPolygon(context, left, 0.24);
  context.fillStyle = leftGradient;
  context.fill();

  const rightGradient = context.createLinearGradient(245, 80, 135, 210);
  rightGradient.addColorStop(0, "#eee9df");
  rightGradient.addColorStop(0.62, "#ddd6ca");
  rightGradient.addColorStop(1, "#c9c0b2");
  roundedPolygon(context, right, 0.24);
  context.fillStyle = rightGradient;
  context.fill();
  context.restore();

  drawClayTexture(context, left, 1931, 115);
  drawClayTexture(context, right, 7823, 115);

  drawProjectedPips(context, left, SIDE_VALUES[value][0], {
    alpha: 0.48,
    radiusX: 5.5,
    radiusY: 7.5,
    accent,
  });
  drawProjectedPips(context, right, SIDE_VALUES[value][1], {
    alpha: 0.42,
    radiusX: 5.5,
    radiusY: 7.5,
    accent,
  });

  context.fillStyle = "#cec7ba";
  [{ x: 140, y: 136, r: 11 }].forEach(({ x, y, r }) => {
    context.beginPath();
    context.arc(x, y, r, 0, Math.PI * 2);
    context.fill();
  });

  const topGradient = context.createLinearGradient(72, 28, 205, 140);
  topGradient.addColorStop(0, "#fffdf7");
  topGradient.addColorStop(0.5, "#f7f2e9");
  topGradient.addColorStop(1, "#e8e1d5");
  roundedPolygon(context, top, 0.25);
  context.fillStyle = topGradient;
  context.fill();
  context.strokeStyle = "rgba(110, 99, 81, 0.1)";
  context.lineWidth = 1.2;
  context.stroke();

  const glow = context.createRadialGradient(95, 42, 2, 103, 50, 90);
  glow.addColorStop(0, "rgba(255,255,255,0.2)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  roundedPolygon(context, top, 0.25);
  context.fillStyle = glow;
  context.fill();

  drawClayTexture(context, top, 4217, 145);

  drawProjectedPips(context, top, value, { accent });
}

function setDieValue(element, value, announce = true) {
  element.dataset.value = value;
  element.classList.remove("is-spinning");
  const reel = element.querySelector(".die-reel");
  reel.style.transition = "none";
  reel.style.transform = "translateY(0)";
  reel.innerHTML = renderPipFace(value);
  if (announce) {
    element.setAttribute("aria-label", `${element === dieOne ? "첫" : "두"} 번째 주사위: ${value}`);
  }
}

function setInteractionLocked(locked) {
  isRolling = locked;
  rollButton.disabled = locked;
  decreasePlayersButton.disabled = locked || playerCount === MIN_PLAYERS;
  increasePlayersButton.disabled = locked || playerCount === MAX_PLAYERS;
  document.querySelectorAll(".player-name").forEach((input) => {
    input.disabled = locked;
  });
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
  const losers = results
    .map((result, index) => (result.lastDigit === lowest ? index : -1))
    .filter((index) => index !== -1);
  const loserNames = losers.map((index) => getPlayerName(index)).join(", ");

  updatePlayerCards(losers);
  gameTitle.textContent = `${loserNames} 당첨! 🎉`;
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
  gameTitle.textContent = "잘~ 먹겠습니다! 😋";
  document.body.classList.remove("is-finished");
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
  if (isRolling) return;
  const nextCount = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, playerCount + amount));
  if (nextCount === playerCount) return;

  if (nextCount > playerCount) {
    for (let index = playerCount; index < nextCount; index += 1) {
      playerNames.push("");
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
  if (isRolling) return;

  if (gameFinished) {
    resetGame();
    return;
  }

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

    if (currentPlayer === playerCount - 1) {
      finishGame();
    } else {
      currentPlayer += 1;
      updatePlayerCards();
      turnLabel.textContent = `${getPlayerName(currentPlayer)} 차례`;
      buttonLabel.textContent = "굴리기";
      hint.textContent = `${getPlayerName(currentPlayer)} 차례 · 휴대폰을 다음 사람에게 넘겨주세요`;
    }

    setInteractionLocked(false);
  }, ROLL_DURATION);
}

createPlayerCards();
createDiceFaces(dieOne);
createDiceFaces(dieTwo);
setDieValue(dieOne, 1);
setDieValue(dieTwo, 1);

function redrawDice() {
  setDieValue(dieOne, Number(dieOne.dataset.value) || 1, false);
  setDieValue(dieTwo, Number(dieTwo.dataset.value) || 1, false);
}

// Redraw after the first layout pass and whenever the responsive stage changes.
// This keeps the canvas texture crisp and prevents a blank GPU layer on mobile.
window.requestAnimationFrame(() => window.requestAnimationFrame(redrawDice));
window.setTimeout(redrawDice, 120);
window.setTimeout(redrawDice, 360);
window.addEventListener("resize", redrawDice);

rollButton.addEventListener("click", rollDice);
decreasePlayersButton.addEventListener("click", () => changePlayerCount(-1));
increasePlayersButton.addEventListener("click", () => changePlayerCount(1));
