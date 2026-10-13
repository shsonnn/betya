const app = document.querySelector("#app");
const homeTemplate = document.querySelector("#home-template");
const brand = document.querySelector(".brand");

const state = {
  dice: { people: [], rolls: [] },
  pick: { items: [], winners: [], isSpinning: false },
  team: { people: [], pairs: [], teams: [], isSpinning: false },
};

const diceFaces = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

brand.addEventListener("click", () => window.BetyaRoom?.leave());
window.addEventListener("hashchange", renderRoute);
document.addEventListener("betya-show-home", renderHome);

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
  if (route === "home") window.BetyaRoom?.hideLocalReactions?.();
  else window.BetyaRoom?.showLocalReactions?.();
  if (route === "pick") renderPick();
  else if (route === "team") renderTeam();
  else if (route === "dice") renderDice();
  else renderHome();
  window.scrollTo({ top: 0, behavior: "auto" });
}

function renderHome() {
  window.BetyaRoom?.hideLocalReactions?.();
  delete document.body.dataset.lobby;
  document.body.dataset.route = "home";
  document.querySelector(".site-header").hidden = false;
  app.replaceChildren(homeTemplate.content.cloneNode(true));
  document.querySelectorAll(".game-card[data-route]").forEach((card) => {
    card.addEventListener("click", () => {
      if (window.BetyaRoom?.hasSession()) navigate(card.dataset.route);
      else window.BetyaRoom?.openLobby(card.dataset.route);
    });
  });
}

function pageShell(theme, title, subtitle, setupMarkup, resultMarkup) {
  app.innerHTML = `
    <section class="game-page theme-${theme}">
      <div class="game-heading">
        <div class="game-heading__copy"><h1>${title}</h1><p>${subtitle}</p></div>
        <button class="back-button" type="button" aria-label="게임 선택으로 돌아가기" data-back>게임 선택</button>
      </div>
      <div class="workspace">
        <section class="panel">${setupMarkup}</section>
        <section class="panel result-panel">${resultMarkup}</section>
      </div>
    </section>`;
  document.querySelector("[data-back]").addEventListener("click", () => window.BetyaRoom?.leave());
}

function entryMarkup({ title, helper, placeholder, type, items, extra = "", buttonText = "추가" }) {
  return `
    <h2>${title}</h2>
    <p class="helper">${helper}</p>
    <div class="entry-row">
      <input class="text-input" data-entry-input type="text" placeholder="${placeholder}" autocomplete="off" />
      <button class="mini-button" type="button" data-entry-add>${buttonText}</button>
    </div>
    <div class="chip-list" data-chip-list>${chipMarkup(items, type)}</div>
    ${extra}`;
}

function chipMarkup(items, type) {
  return items.map((item, index) => `
    <span class="chip">${escapeHtml(item)}
      <button type="button" aria-label="${escapeHtml(item)} 삭제" data-remove-${type}="${index}">×</button>
    </span>`).join("");
}

function bindEntry(type, rerender) {
  const input = document.querySelector("[data-entry-input]");
  const add = () => {
    const values = input.value.split(/[,\n]/).map((value) => value.trim()).filter(Boolean);
    if (!values.length) return;
    const target = type === "pick" ? state.pick.items : type === "team" ? state.team.people : state.dice.people;
    values.forEach((value) => {
      if (!target.includes(value)) target.push(value);
    });
    input.value = "";
    rerender();
    document.querySelector("[data-entry-input]")?.focus();
  };
  document.querySelector("[data-entry-add]").addEventListener("click", add);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) event.preventDefault();
  });
  input.addEventListener("keyup", (event) => {
    if (event.key === "Enter" && !event.isComposing) add();
  });
  document.querySelectorAll(`[data-remove-${type}]`).forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset[`remove${capitalize(type)}`]);
      if (type === "pick") state.pick.items.splice(index, 1);
      if (type === "dice") state.dice.people.splice(index, 1);
      if (type === "team") {
        const removed = state.team.people[index];
        state.team.people.splice(index, 1);
        state.team.pairs = state.team.pairs.filter((pair) => !pair.includes(removed));
      }
      rerender();
    });
  });
}

function renderPick() {
  const max = Math.max(1, state.pick.items.length);
  const currentCount = Math.min(Number(sessionStorage.getItem("pick-count")) || 1, max);
  let result = emptyResult("🎯", "아직 아무도 안 걸렸어요", "항목을 넣고 뽑기 버튼을 눌러주세요.");
  if (state.pick.isSpinning) result = rouletteMarkup("누가 걸릴까요?", "입력한 항목들을 신나게 섞는 중이에요");
  else if (state.pick.winners.length) {
    result = `<div class="reveal-heading"><span>짠! 🎉</span><h2>오늘의 당첨 결과</h2><p class="helper">운명은 이미 정해졌습니다. 이의 신청은 받지 않아요.</p></div>
       <div class="winner-list">${state.pick.winners.map((name, index) => `<div class="winner" style="animation-delay:${index * 90}ms"><span>${index + 1}</span><strong>${escapeHtml(name)}</strong></div>`).join("")}</div>`;
  }

  const extra = `
    <label class="field-label" for="pick-count">몇 명을 뽑을까요?</label>
    <div class="split-control"><span>당첨 인원</span><input id="pick-count" class="number-input" type="number" min="1" max="${max}" value="${currentCount}" /></div>
    <button class="primary-button" type="button" data-pick ${state.pick.items.length && !state.pick.isSpinning ? "" : "disabled"}>${state.pick.isSpinning ? "두근두근…" : state.pick.winners.length ? "다시 뽑기" : "랜덤으로 뽑기"}</button>`;

  pageShell("pick", "아무나 걸려라", "그냥 아묻따 랜덤 뽑기 ㄷㄷ", 
    entryMarkup({ title: "뽑을 항목", helper: "쉼표로 여러 개를 한 번에 추가할 수도 있어요.", placeholder: "예: 민수, 지연, 현우", type: "pick", items: state.pick.items, extra }), result);

  bindEntry("pick", renderPick);
  const countInput = document.querySelector("#pick-count");
  countInput.addEventListener("change", () => {
    const safe = clamp(Number(countInput.value) || 1, 1, max);
    countInput.value = safe;
    sessionStorage.setItem("pick-count", safe);
  });
  document.querySelector("[data-pick]").addEventListener("click", async () => {
    const count = clamp(Number(countInput.value) || 1, 1, state.pick.items.length);
    const winners = shuffle([...state.pick.items]).slice(0, count);
    state.pick.isSpinning = true;
    renderPick();
    await animateRoulette(state.pick.items);
    state.pick.winners = winners;
    state.pick.isSpinning = false;
    renderPick();
  });
}

function renderTeam() {
  const maxTeams = Math.max(2, state.team.people.length || 2);
  const teamCount = clamp(Number(sessionStorage.getItem("team-count")) || 2, 2, maxTeams);
  const options = state.team.people.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
  const pairs = state.team.pairs.map((pair, index) => `<div class="pair-item"><span>${escapeHtml(pair[0])} ↔ ${escapeHtml(pair[1])}</span><button type="button" data-remove-pair="${index}">삭제</button></div>`).join("");
  const extra = `
    <label class="field-label" for="team-count">나눌 팀 개수</label>
    <div class="split-control split-control--number"><input id="team-count" class="number-input" type="number" min="2" max="${maxTeams}" value="${teamCount}" aria-label="나눌 팀 개수" /></div>
    <label class="field-label">절대 같은 팀이면 안 되는 사람</label>
    <div class="pair-row">
      <select class="select-input" data-pair-a aria-label="첫 번째 사람"><option value="">사람 1</option>${options}</select>
      <select class="select-input" data-pair-b aria-label="두 번째 사람"><option value="">사람 2</option>${options}</select>
      <button class="mini-button" type="button" data-add-pair>설정</button>
    </div>
    <div class="pair-list">${pairs}</div>
    <button class="primary-button" type="button" data-make-teams ${state.team.people.length >= 2 && !state.team.isSpinning ? "" : "disabled"}>${state.team.isSpinning ? "팀을 섞는 중…" : state.team.teams.length ? "다시 나누기" : "팀 나누기"}</button>`;

  let result = emptyResult("🙌", "팀이 만들어질 자리예요", "이름을 두 명 이상 추가한 뒤 팀을 나눠주세요.");
  if (state.team.isSpinning) {
    result = rouletteMarkup("팀 조합 중!", "모두가 납득할 수 있게 열심히 섞는 중이에요");
  } else if (state.team.teams.length) {
    const conflictCount = countConflicts(state.team.teams, state.team.pairs);
    result = `<div class="reveal-heading"><span>짠! 🎉</span><h2>팀 나누기 완료!</h2><p class="helper">공평하게 섞었어요. 이제 게임만 시작하면 됩니다.</p></div>
      <div class="team-results">${state.team.teams.map((team, index) => `<div class="team-box" style="animation-delay:${index * 70}ms"><h3>TEAM ${index + 1}</h3><ul>${team.map((name) => `<li>${escapeHtml(name)}</li>`).join("")}</ul></div>`).join("")}</div>
      ${conflictCount ? `<p class="warning">⚠️ 인원·팀 수 조합상 피할 수 없는 금지 조합이 ${conflictCount}개 있어요. 팀 수를 늘려보세요.</p>` : ""}`;
  }

  pageShell("team", "팀 나누기", "아 팀전으로 가면가~", 
    entryMarkup({ title: "참가자 이름", helper: "같은 이름은 한 번만 추가돼요.", placeholder: "이름을 입력하고 Enter", type: "team", items: state.team.people, extra }), result);

  bindEntry("team", renderTeam);
  const teamInput = document.querySelector("#team-count");
  teamInput.addEventListener("change", () => {
    const safe = clamp(Number(teamInput.value) || 2, 2, maxTeams);
    teamInput.value = safe;
    sessionStorage.setItem("team-count", safe);
  });
  document.querySelector("[data-add-pair]").addEventListener("click", () => {
    const a = document.querySelector("[data-pair-a]").value;
    const b = document.querySelector("[data-pair-b]").value;
    if (!a || !b) return toast("두 사람을 모두 골라주세요.");
    if (a === b) return toast("서로 다른 두 사람을 골라주세요.");
    if (state.team.pairs.some((pair) => pair.includes(a) && pair.includes(b))) return toast("이미 설정한 조합이에요.");
    state.team.pairs.push([a, b]);
    renderTeam();
  });
  document.querySelectorAll("[data-remove-pair]").forEach((button) => button.addEventListener("click", () => {
    state.team.pairs.splice(Number(button.dataset.removePair), 1);
    renderTeam();
  }));
  document.querySelector("[data-make-teams]").addEventListener("click", async () => {
    const count = clamp(Number(teamInput.value) || 2, 2, state.team.people.length);
    const teams = makeBestTeams(state.team.people, count, state.team.pairs);
    state.team.isSpinning = true;
    renderTeam();
    await animateRoulette(state.team.people);
    state.team.teams = teams;
    state.team.isSpinning = false;
    renderTeam();
  });
}

function rouletteMarkup(title, copy) {
  return `<div class="roulette-stage" role="status" aria-live="polite">
    <span class="roulette-kicker">두근두근</span>
    <strong data-roulette-value>?</strong>
    <h2>${title}</h2>
    <p>${copy}</p>
  </div>`;
}

async function animateRoulette(values) {
  const sequence = shuffle([...values, ...values, ...values]);
  const frameCount = reducedMotion ? 2 : Math.min(22, Math.max(14, sequence.length));
  for (let index = 0; index < frameCount; index += 1) {
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
  const extra = `<button class="primary-button" type="button" data-roll ${state.dice.people.length ? "" : "disabled"}>${state.dice.rolls.length ? "다시 굴리기" : "모두 굴리기"}</button>`;
  pageShell("dice", "0의 주사위", "두 번 굴려 더한 값이 가장 낮은 사람이 쏘기~!",
    entryMarkup({ title: "참가자 이름", helper: "주사위를 굴릴 친구들을 추가해주세요.", placeholder: "이름을 입력하고 Enter", type: "dice", items: state.dice.people, extra }), result);
  bindEntry("dice", renderDice);
  document.querySelector("[data-roll]").addEventListener("click", rollAllDice);
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
  return `<div class="empty-result"><div><span class="empty-result__icon">${icon}</span><strong>${title}</strong><span>${copy}</span></div></div>`;
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
else renderHome();
