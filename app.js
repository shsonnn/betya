const app = document.querySelector("#app");
const homeTemplate = document.querySelector("#home-template");
const brand = document.querySelector(".brand");
const homePattern = document.querySelector(".home-pattern");

if (homePattern) {
  const pattern = document.createDocumentFragment();
  for (let row = 0; row < 15; row += 1) {
    const line = document.createElement("div");
    line.className = "home-pattern-row";
    line.style.setProperty("--row", row);
    line.style.setProperty("--shift", row % 2);
    for (let column = 0; column < 11; column += 1) {
      const icon = document.createElement("img");
      icon.src = "./assets/home/figma-2025/pattern.svg";
      icon.alt = "";
      line.append(icon);
    }
    pattern.append(line);
  }
  homePattern.append(pattern);
}

const state = {
  dice: { people: [], rolls: [] },
  pick: { items: [], winners: [], count: 1, isSpinning: false },
  team: { people: [], pairs: [], teams: [], count: 2, isSpinning: false },
};
let remoteGameRevision = -1;
let remoteAnimationId = 0;
let pickDirty = false;
let teamDirty = false;

function inRoom() {
  return window.BetyaRoom?.session()?.backend === "room-v2";
}

function isGuest() {
  return Boolean(window.BetyaRoom?.session()) && !window.BetyaRoom.isHost();
}

function sendPickSetup() {
  if (!inRoom() || isGuest()) return;
  pickDirty = true;
  const button = document.querySelector("[data-pick]");
  if (button) button.disabled = true;
  window.BetyaRoom.send("game.configure", {
    items: state.pick.items,
    pick_count: clamp(state.pick.count, 1, Math.max(1, state.pick.items.length)),
  });
}

function sendTeamSetup() {
  if (!inRoom() || isGuest()) return;
  teamDirty = true;
  const button = document.querySelector("[data-make-teams]");
  if (button) button.disabled = true;
  window.BetyaRoom.send("game.configure", {
    people: state.team.people,
    team_count: clamp(state.team.count, 2, Math.max(2, state.team.people.length)),
    pairs: state.team.pairs,
  });
}

function lockGuestControls() {
  if (!isGuest()) return;
  document.querySelectorAll(".game-page input, .game-page select, .game-page .mini-button, .game-page .game-stepper__button, .game-page .chip button, .game-page .pair-item button, .game-page .primary-button")
    .forEach((control) => { control.disabled = true; });
}

function renderPreservingEntry(render) {
  const active = !isGuest() && document.activeElement?.matches("[data-entry-input]")
    ? document.activeElement : null;
  const draft = active?.value;
  const selectionStart = active?.selectionStart;
  const selectionEnd = active?.selectionEnd;
  render();
  if (active) {
    const input = document.querySelector("[data-entry-input]");
    input.value = draft;
    input.focus();
    if (selectionStart !== null && selectionEnd !== null) input.setSelectionRange(selectionStart, selectionEnd);
  }
}

const diceFaces = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

brand.addEventListener("click", () => window.BetyaRoom?.leave());
window.addEventListener("hashchange", renderRoute);

function navigate(route) {
  if (route === "dice") {
    window.location.href = "./dice.html";
    return;
  }
  const next = route === "home" ? "" : `#${route}`;
  if (window.location.hash === next) renderRoute();
  else window.location.hash = next;
}

function currentRoute() {
  return window.location.hash.replace("#", "") || "home";
}

function renderRoute() {
  if (!window.BetyaRoom?.hasSession()) return;
  const route = currentRoute();
  document.body.dataset.route = route;
  if (route === "pick") renderPick();
  else if (route === "team") renderTeam();
  else if (route === "dice") renderDice();
  else renderHome();
  window.scrollTo({ top: 0, behavior: "auto" });
}

function renderHome() {
  app.replaceChildren(homeTemplate.content.cloneNode(true));
  document.querySelectorAll(".game-card[data-route]").forEach((card) => {
    card.addEventListener("click", () => navigate(card.dataset.route));
  });
}

function pageShell(theme, title, subtitle, setupMarkup, resultMarkup, actionMarkup = "") {
  app.innerHTML = `
    <section class="game-page theme-${theme}">
      <div class="game-heading">
        <div class="game-heading__copy"><h1>${title}</h1><p>${subtitle}</p></div>
        <button class="back-button" type="button" aria-label="방 나가기" data-back>방 나가기</button>
      </div>
      <div class="workspace">
        <div class="game-settings-frame"><section class="panel settings-panel">${setupMarkup}</section></div>
        <section class="panel result-panel"><div class="result-stage-wrap">${resultMarkup}</div>${actionMarkup}</section>
      </div>
    </section>`;
  document.querySelector("[data-back]").addEventListener("click", () => window.BetyaRoom?.leave());
}

function stepperMarkup(label, count, unit, minimum, maximum) {
  return `<div class="game-count-control" aria-label="${label}">
    <span class="game-count-control__label">${label}</span>
    <div class="game-count-control__stepper">
      <button class="game-stepper__button" type="button" data-count-step="-1" aria-label="${label} 줄이기" ${count <= minimum ? "disabled" : ""}><img src="./assets/game/minus-icon.svg" alt="" /></button>
      <strong aria-live="polite">${count}${unit}</strong>
      <button class="game-stepper__button" type="button" data-count-step="1" aria-label="${label} 늘리기" ${count >= maximum ? "disabled" : ""}><img src="./assets/game/plus-icon.svg" alt="" /></button>
    </div>
  </div>`;
}

function entryMarkup({ helper, placeholder, type, items, extra = "" }) {
  return `
    <p class="helper">${helper}</p>
    <div class="entry-row">
      <span class="sketch-input-frame"><input class="text-input" data-entry-input type="text" placeholder="${placeholder}" autocomplete="off" /></span>
      <button class="mini-button" type="button" data-entry-add><span>추가</span></button>
    </div>
    <div class="chip-list" data-chip-list>${chipMarkup(items, type)}</div>
    ${extra}`;
}

function chipMarkup(items, type) {
  return items.map((item, index) => `
    <span class="chip"><span class="chip__label">${escapeHtml(item)}</span>
      <button type="button" aria-label="${escapeHtml(item)} 삭제" data-remove-${type}="${index}"><img src="./assets/game/chip-remove.svg" alt="" /></button>
    </span>`).join("");
}

function bindEntry(type, rerender) {
  const input = document.querySelector("[data-entry-input]");
  let composing = false;
  let compositionEndedAt = -Infinity;
  let imeEnterPending = false;
  let imeAddTimer = 0;
  const add = () => {
    if (isGuest()) return;
    const values = input.value.split(/[,\n]/).map((value) => value.trim()).filter(Boolean);
    if (!values.length) return;
    const target = type === "pick" ? state.pick.items : type === "team" ? state.team.people : state.dice.people;
    values.forEach((value) => {
      if (!target.includes(value)) target.push(value);
    });
    input.value = "";
    rerender();
    document.querySelector("[data-entry-input]")?.focus();
    if (type === "pick") sendPickSetup();
    else if (type === "team") sendTeamSetup();
  };
  const queueImeAdd = () => {
    if (imeAddTimer) return;
    imeAddTimer = window.setTimeout(() => {
      imeAddTimer = 0;
      if (input.isConnected) add();
    }, 0);
  };
  document.querySelector("[data-entry-add]").addEventListener("click", add);
  input.addEventListener("compositionstart", () => { composing = true; });
  input.addEventListener("compositionend", () => {
    composing = false;
    compositionEndedAt = performance.now();
    if (imeEnterPending) {
      imeEnterPending = false;
      queueImeAdd();
    }
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      // Enter can finish a Korean IME syllable before it should submit a new item.
      if (event.isComposing || composing || event.keyCode === 229) {
        imeEnterPending = true;
        // Some browsers report keyCode 229 after compositionend; don't strand that Enter.
        window.setTimeout(() => {
          if (!composing && imeEnterPending && input.isConnected) {
            imeEnterPending = false;
            queueImeAdd();
          }
        }, 40);
        return;
      }
      event.preventDefault();
      if (performance.now() - compositionEndedAt < 40) {
        queueImeAdd();
        return;
      }
      add();
    }
  });
  document.querySelectorAll(`[data-remove-${type}]`).forEach((button) => {
    button.addEventListener("click", () => {
      if (isGuest()) return;
      const index = Number(button.dataset[`remove${capitalize(type)}`]);
      if (type === "pick") state.pick.items.splice(index, 1);
      if (type === "dice") state.dice.people.splice(index, 1);
      if (type === "team") {
        const removed = state.team.people[index];
        state.team.people.splice(index, 1);
        state.team.pairs = state.team.pairs.filter((pair) => !pair.includes(removed));
      }
      rerender();
      if (type === "pick") sendPickSetup();
      else if (type === "team") sendTeamSetup();
    });
  });
}

function renderPick() {
  const max = Math.max(1, state.pick.items.length);
  const currentCount = Math.min(inRoom() ? state.pick.count : Number(sessionStorage.getItem("pick-count")) || 1, max);
  let result = emptyResult("./assets/game/pick-empty.svg", "아직 아무도 안 걸렸어요", "항목을 넣고 뽑기 버튼을 눌러주세요.");
  if (state.pick.isSpinning) result = rouletteMarkup("누가 걸릴까요?", "입력한 항목들을 신나게 섞는 중이에요");
  else if (state.pick.winners.length) {
    result = `<div class="reveal-heading"><span>짠! 🎉</span><h2>오늘의 당첨 결과</h2><p class="helper">운명은 이미 정해졌습니다. 이의 신청은 받지 않아요.</p></div>
       <div class="winner-list">${state.pick.winners.map((name, index) => `<div class="winner" style="animation-delay:${index * 90}ms"><span>${index + 1}</span><strong>${escapeHtml(name)}</strong></div>`).join("")}</div>`;
  }

  const action = isGuest() ? "" : `<button class="primary-button" type="button" data-pick ${state.pick.items.length && !state.pick.isSpinning && !pickDirty ? "" : "disabled"}><span>${state.pick.isSpinning ? "두근두근…" : state.pick.winners.length ? "다시 뽑기" : "바로 뽑아버려"}</span></button>`;

  pageShell("pick", "아무나 걸려라", "그냥 아묻따 랜덤 뽑기 ㄷㄷ", 
    stepperMarkup("당첨 인원", currentCount, "명", 1, max)
    + entryMarkup({ helper: "쉼표로 여러 개를 한 번에 추가할 수도 있어요.", placeholder: "예: 민수, 지연, 현우", type: "pick", items: state.pick.items }), result, action);

  bindEntry("pick", renderPick);
  bindCountStepper("pick", currentCount, 1, max);
  document.querySelector("[data-pick]")?.addEventListener("click", async () => {
    if (inRoom()) {
      if (!isGuest() && !window.BetyaRoom.send("game.draw")) toast("방 연결을 확인해주세요.");
      return;
    }
    const count = clamp(currentCount, 1, state.pick.items.length);
    const winners = shuffle([...state.pick.items]).slice(0, count);
    state.pick.isSpinning = true;
    renderPreservingEntry(renderPick);
    await animateRoulette(state.pick.items);
    state.pick.winners = winners;
    state.pick.isSpinning = false;
    renderPick();
  });
  lockGuestControls();
}

function renderTeam() {
  const maxTeams = Math.max(2, state.team.people.length || 2);
  const teamCount = clamp(inRoom() ? state.team.count : Number(sessionStorage.getItem("team-count")) || 2, 2, maxTeams);
  const options = state.team.people.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
  const pairs = state.team.pairs.map((pair, index) => `<div class="pair-item"><span>${escapeHtml(pair[0])}<img src="./assets/game/pair-arrow.svg" alt="와" />${escapeHtml(pair[1])}</span><button type="button" aria-label="${escapeHtml(pair[0])}와 ${escapeHtml(pair[1])} 조합 삭제" data-remove-pair="${index}"><img src="./assets/game/chip-remove.svg" alt="" /></button></div>`).join("");
  const extra = `
    <div class="pair-settings"><label class="field-label">같은 팀은 피할래요</label>
    <div class="pair-row">
      <span class="sketch-input-frame sketch-input-frame--select"><select class="select-input" data-pair-a aria-label="첫 번째 사람"><option value="">팀원을 고르세요</option>${options}</select></span>
      <span class="sketch-input-frame sketch-input-frame--select"><select class="select-input" data-pair-b aria-label="두 번째 사람"><option value="">팀원을 고르세요</option>${options}</select></span>
      <button class="mini-button" type="button" data-add-pair><span>적용</span></button>
    </div>
    <div class="pair-list">${pairs}</div></div>`;
  const action = isGuest() ? "" : `<button class="primary-button" type="button" data-make-teams ${state.team.people.length >= 2 && !state.team.isSpinning && !teamDirty ? "" : "disabled"}><span>${state.team.isSpinning ? "팀을 섞는 중…" : state.team.teams.length ? "다시 나누기" : "팀 나누기"}</span></button>`;

  let result = emptyResult("./assets/game/team-empty.svg", "팀이 만들어질 자리예요", "인원을 두 명 이상 추가한 뒤 팀을 나눠주세요!");
  if (state.team.isSpinning) {
    result = rouletteMarkup("팀 조합 중!", "모두가 납득할 수 있게 열심히 섞는 중이에요");
  } else if (state.team.teams.length) {
    const conflictCount = countConflicts(state.team.teams, state.team.pairs);
    result = `<div class="reveal-heading"><span>짠! 🎉</span><h2>팀 나누기 완료!</h2><p class="helper">공평하게 섞었어요. 이제 게임만 시작하면 됩니다.</p></div>
      <div class="team-results">${state.team.teams.map((team, index) => `<div class="team-box" style="animation-delay:${index * 70}ms"><h3>TEAM ${index + 1}</h3><ul>${team.map((name) => `<li>${escapeHtml(name)}</li>`).join("")}</ul></div>`).join("")}</div>
      ${conflictCount ? `<p class="warning">⚠️ 인원·팀 수 조합상 피할 수 없는 금지 조합이 ${conflictCount}개 있어요. 팀 수를 늘려보세요.</p>` : ""}`;
  }

  pageShell("team", "팀 나누기", "아 팀전으로 가면가~", 
    stepperMarkup("팀 개수", teamCount, "팀", 2, maxTeams)
    + `<div class="team-entry-group">${entryMarkup({ helper: "이름을 입력한 후 Enter 해주세요", placeholder: "예: 민수", type: "team", items: state.team.people })}</div>` + extra, result, action);

  bindEntry("team", renderTeam);
  bindCountStepper("team", teamCount, 2, maxTeams);
  document.querySelector("[data-add-pair]").addEventListener("click", () => {
    if (isGuest()) return;
    const a = document.querySelector("[data-pair-a]").value;
    const b = document.querySelector("[data-pair-b]").value;
    if (!a || !b) return toast("두 사람을 모두 골라주세요.");
    if (a === b) return toast("서로 다른 두 사람을 골라주세요.");
    if (state.team.pairs.some((pair) => pair.includes(a) && pair.includes(b))) return toast("이미 설정한 조합이에요.");
    state.team.pairs.push([a, b]);
    renderPreservingEntry(renderTeam);
    sendTeamSetup();
  });
  document.querySelectorAll("[data-remove-pair]").forEach((button) => button.addEventListener("click", () => {
    if (isGuest()) return;
    state.team.pairs.splice(Number(button.dataset.removePair), 1);
    renderTeam();
    sendTeamSetup();
  }));
  document.querySelector("[data-make-teams]")?.addEventListener("click", async () => {
    if (inRoom()) {
      if (!isGuest() && !window.BetyaRoom.send("game.divide")) toast("방 연결을 확인해주세요.");
      return;
    }
    const count = clamp(teamCount, 2, state.team.people.length);
    const teams = makeBestTeams(state.team.people, count, state.team.pairs);
    state.team.isSpinning = true;
    renderTeam();
    await animateRoulette(state.team.people);
    state.team.teams = teams;
    state.team.isSpinning = false;
    renderTeam();
  });
  lockGuestControls();
}

function rouletteMarkup(title, copy) {
  return `<div class="roulette-stage" role="status" aria-live="polite">
    <span class="roulette-kicker">두근두근</span>
    <strong data-roulette-value>?</strong>
    <h2>${title}</h2>
    <p>${copy}</p>
  </div>`;
}

async function animateRoulette(values, isCurrent = () => true) {
  const sequence = shuffle([...values, ...values, ...values]);
  const frameCount = reducedMotion ? 2 : Math.min(22, Math.max(14, sequence.length));
  for (let index = 0; index < frameCount; index += 1) {
    if (!isCurrent()) return;
    const value = document.querySelector("[data-roulette-value]");
    if (value) {
      value.classList.remove("is-changing");
      void value.offsetWidth;
      value.textContent = sequence[index % sequence.length];
      value.classList.add("is-changing");
    }
    const progress = frameCount <= 1 ? 1 : index / (frameCount - 1);
    const delay = reducedMotion ? 40 : Math.round(48 + Math.pow(progress, 2.7) * 300);
    await wait(delay);
  }
}

function applyRoomGame(detail) {
  const game = detail?.payload?.game;
  if (!inRoom() || !game || game.revision < remoteGameRevision) return;
  if (!isGuest() && detail.type !== "game.drawn" && detail.type !== "game.divided") {
    if (game.type === "random_pick" && pickDirty) {
      const matches = game.pick_count === clamp(state.pick.count, 1, Math.max(1, state.pick.items.length))
        && JSON.stringify(game.items) === JSON.stringify(state.pick.items);
      if (!matches) {
        remoteGameRevision = game.revision;
        sendPickSetup();
        return;
      }
      pickDirty = false;
    }
    if (game.type === "teams" && teamDirty) {
      const matches = game.team_count === clamp(state.team.count, 2, Math.max(2, state.team.people.length))
        && JSON.stringify(game.people) === JSON.stringify(state.team.people)
        && JSON.stringify(game.pairs) === JSON.stringify(state.team.pairs);
      if (!matches) {
        remoteGameRevision = game.revision;
        sendTeamSetup();
        return;
      }
      teamDirty = false;
    }
  }
  remoteGameRevision = game.revision;
  const animationId = ++remoteAnimationId;
  if (game.type === "random_pick") {
    state.pick.items = [...(game.items || [])];
    state.pick.count = game.pick_count || 1;
    state.pick.winners = [...(game.winners || [])];
    const reveal = (detail.type === "game.drawn" || detail.type === "game.snapshot") && game.animation_until_ms > Date.now();
    state.pick.isSpinning = reveal;
    renderPreservingEntry(renderPick);
    if (reveal) animateRoulette(state.pick.items, () => animationId === remoteAnimationId)
      .then(() => {
        if (animationId !== remoteAnimationId) return;
        state.pick.isSpinning = false;
        renderPick();
      });
  } else if (game.type === "teams") {
    state.team.people = [...(game.people || [])];
    state.team.count = game.team_count || 2;
    state.team.pairs = (game.pairs || []).map((pair) => [...pair]);
    state.team.teams = (game.teams || []).map((team) => [...team]);
    const reveal = (detail.type === "game.divided" || detail.type === "game.snapshot") && game.animation_until_ms > Date.now();
    state.team.isSpinning = reveal;
    renderPreservingEntry(renderTeam);
    if (reveal) animateRoulette(state.team.people, () => animationId === remoteAnimationId)
      .then(() => {
        if (animationId !== remoteAnimationId) return;
        state.team.isSpinning = false;
        renderTeam();
      });
  }
}

function wait(duration) {
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}

function renderDice() {
  const result = state.dice.rolls.length
    ? `<h2>주사위 결과</h2><p class="helper">합이 가장 낮은 사람이 오늘의 주인공!</p>
       <div class="dice-results">${diceResultMarkup()}</div>`
    : `<h2>두 번 굴리기</h2><p class="helper">모든 참가자가 주사위를 두 번씩 굴려요.</p>
       <div class="dice-stage"><div class="die" data-die-a>⚀</div><div class="die" data-die-b>⚀</div></div>
       <p class="dice-total">두 주사위의 합으로 승부합니다.</p>`;
  const extra = isGuest() ? "" : `<button class="primary-button" type="button" data-roll ${state.dice.people.length ? "" : "disabled"}>${state.dice.rolls.length ? "다시 굴리기" : "모두 굴리기"}</button>`;
  pageShell("dice", "0의 주사위", "두 번 굴려 더한 값이 가장 낮은 사람이 쏘기~!",
    entryMarkup({ title: "참가자 이름", helper: "주사위를 굴릴 친구들을 추가해주세요.", placeholder: "이름을 입력하고 Enter", type: "dice", items: state.dice.people }), result, extra);
  bindEntry("dice", renderDice);
  document.querySelector("[data-roll]")?.addEventListener("click", rollAllDice);
}

function rollAllDice() {
  state.dice.rolls = state.dice.people.map((name) => {
    const first = randomInt(1, 6);
    const second = randomInt(1, 6);
    return { name, first, second, total: first + second };
  }).sort((a, b) => a.total - b.total);
  renderDice();
}

function diceResultMarkup() {
  const lowest = Math.min(...state.dice.rolls.map((roll) => roll.total));
  return state.dice.rolls.map((roll) => `<div class="dice-result ${roll.total === lowest ? "is-loser" : ""}">
    <strong>${escapeHtml(roll.name)}${roll.total === lowest ? " 👑" : ""}</strong>
    <span>${diceFaces[roll.first - 1]} + ${diceFaces[roll.second - 1]}</span>
    <em>${roll.total}</em>
  </div>`).join("");
}

function makeBestTeams(people, teamCount, pairs) {
  let best = null;
  let bestScore = Infinity;
  for (let attempt = 0; attempt < 1200; attempt += 1) {
    const teams = Array.from({ length: teamCount }, () => []);
    shuffle([...people]).forEach((person, index) => teams[index % teamCount].push(person));
    const score = countConflicts(teams, pairs);
    if (score < bestScore) {
      best = teams;
      bestScore = score;
      if (score === 0) break;
    }
  }
  return best;
}

function countConflicts(teams, pairs) {
  return teams.reduce((total, team) => total + pairs.filter(([a, b]) => team.includes(a) && team.includes(b)).length, 0);
}

function emptyResult(icon, title, copy) {
  return `<div class="empty-result"><div><img class="empty-result__icon" src="${icon}" alt="" /><strong>${title}</strong><span>${copy}</span></div></div>`;
}

function bindCountStepper(type, value, minimum, maximum) {
  document.querySelectorAll("[data-count-step]").forEach((button) => button.addEventListener("click", () => {
    if (isGuest()) return;
    const next = clamp(value + Number(button.dataset.countStep), minimum, maximum);
    if (next === value) return;
    state[type].count = next;
    sessionStorage.setItem(`${type}-count`, next);
    renderPreservingEntry(type === "pick" ? renderPick : renderTeam);
    if (type === "pick") sendPickSetup();
    else sendTeamSetup();
  }));
}

function toast(message) {
  let node = document.querySelector(".toast");
  if (!node) {
    node = document.createElement("div");
    node.className = "toast";
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 2200);
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function capitalize(value) {
  return value[0].toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

if (window.BetyaRoom?.hasSession()) renderRoute();
document.addEventListener("betya-game", (event) => applyRoomGame(event.detail));
if (inRoom() && window.BetyaRoom.state()?.game) {
  applyRoomGame({ type: "game.snapshot", payload: { game: window.BetyaRoom.state().game } });
}
