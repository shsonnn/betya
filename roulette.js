/* Server-authoritative spins; the same elapsed-time curve runs on every client. */
const spinState = { items: ["", ""], spin: null, revision: -1, dirty: false, pending: false, clockOffset: 0 };
let spinSetupTimer = 0;
let spinFrame = 0;
const cleanSpinItems = () => spinState.items.map(value => value.trim().replace(/\s+/g, " ").slice(0, 40));
const wheelItems = () => cleanSpinItems().filter(Boolean);
const spinNow = () => Date.now() + spinState.clockOffset;
const spinInProgress = () => Boolean(spinState.spin && spinNow() < spinState.spin.started_at_ms + spinState.spin.duration_ms);

function updateSpinButton() {
  const button = document.querySelector("[data-spin-wheel]");
  if (button) button.disabled = wheelItems().length < 2 || spinInProgress() || spinState.dirty || spinState.pending;
}

function sendSpinSetup() {
  clearTimeout(spinSetupTimer);
  if (!inRoom() || isGuest()) return;
  spinState.dirty = true;
  updateSpinButton();
  if (!window.BetyaRoom.send("game.configure", { items: cleanSpinItems() })) {
    toast("방 연결을 확인해주세요. 다시 연결되면 설정을 전송할게요.");
  }
}

function renderSpinGame() {
  const active = document.activeElement;
  const index = active?.dataset?.rouletteItem;
  const selection = index === undefined ? null : [active.selectionStart, active.selectionEnd];
  const scrolling = document.querySelector(".theme-roulette .settings-panel")?.scrollTop || 0;
  const locked = isGuest() || spinInProgress() || spinState.pending;
  const setup = stepperMarkup("항목", spinState.items.length, "개", 2, 24)
    + `<p class="helper">이름을 누르면 바로 수정할 수 있어요.</p><div class="roulette-fields">`
    + spinState.items.map((value, i) => `<span class="sketch-input-frame"><input class="text-input" type="text" data-roulette-item="${i}" aria-label="룰렛 항목 ${i + 1}" placeholder="이름을 입력하세요" maxlength="40" autocomplete="off" value="${escapeHtml(value)}" ${locked ? "disabled" : ""} /></span>`).join("") + `</div>`;
  const action = isGuest() ? "" : `<button class="primary-button" data-spin-wheel type="button"><span>${spinInProgress() || spinState.pending ? "두근두근… 어디서 멈출까요?" : spinState.spin ? "한 번 더 돌려!" : "돌려돌려 돌림판~!"}</span></button>`;
  pageShell("roulette", "돌려돌려", "돌려돌려~ 오늘의 운명을 정해볼까요!", setup, "", action);
  document.querySelectorAll("[data-count-step]").forEach(button => {
    if (locked) button.disabled = true;
    button.addEventListener("click", () => {
      if (isGuest() || spinInProgress() || spinState.pending) return;
      const next = clamp(spinState.items.length + Number(button.dataset.countStep), 2, 24);
      if (next > spinState.items.length) spinState.items.push("");
      else spinState.items.length = next;
      spinState.spin = null;
      renderSpinGame();
      sendSpinSetup();
    });
  });
  document.querySelectorAll("[data-roulette-item]").forEach(input => {
    const commit = () => {
      if (isGuest() || spinInProgress() || spinState.pending) return;
      spinState.items[Number(input.dataset.rouletteItem)] = input.value;
      spinState.spin = null;
      if (inRoom()) {
        spinState.dirty = true;
        clearTimeout(spinSetupTimer);
        spinSetupTimer = setTimeout(sendSpinSetup, 180);
      }
      renderSpinStage();
      updateSpinButton();
    };
    input.addEventListener("input", event => { if (!event.isComposing) commit(); });
    input.addEventListener("compositionend", commit);
    input.addEventListener("keydown", event => {
      if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      const next = Number(input.dataset.rouletteItem) + 1;
      document.querySelector(`[data-roulette-item="${next % spinState.items.length}"]`)?.focus();
    });
  });
  document.querySelector("[data-spin-wheel]")?.addEventListener("click", () => {
    if (isGuest() || spinInProgress() || spinState.dirty || spinState.pending || wheelItems().length < 2) return;
    if (inRoom()) {
      spinState.pending = true;
      renderSpinGame();
      if (!window.BetyaRoom.send("game.spin")) {
        spinState.pending = false;
        renderSpinGame();
        toast("방 연결을 확인해주세요.");
      }
      return;
    }
    spinState.clockOffset = 0;
    spinState.spin = { winner_index: secureWheelRandom(wheelItems().length), turns: 6 + secureWheelRandom(4), started_at_ms: Date.now(), duration_ms: 7200 + secureWheelRandom(1201) };
    renderSpinGame();
  });
  renderSpinStage();
  updateSpinButton();
  lockGuestControls();
  document.querySelector(".settings-panel").scrollTop = scrolling;
  if (index !== undefined && !locked) {
    const input = document.querySelector(`[data-roulette-item="${index}"]`);
    input?.focus({ preventScroll: true });
    if (input && selection) input.setSelectionRange(...selection);
  }
}

function applySpinGame(detail) {
  const game = detail?.payload?.game;
  if (!inRoom() || !game || game.revision < spinState.revision) return;
  spinState.revision = game.revision;
  if (detail.payload.server_time_ms) spinState.clockOffset = detail.payload.server_time_ms - Date.now();
  if (!isGuest() && spinState.dirty && detail.type !== "game.spun") {
    if (JSON.stringify(game.items) !== JSON.stringify(cleanSpinItems())) {
      sendSpinSetup();
      return;
    }
    spinState.dirty = false;
    // A settings acknowledgement must not replace an active IME input.
    if (detail.type === "game.updated") { updateSpinButton(); return; }
  }
  spinState.items = [...(game.items || ["", ""])];
  spinState.spin = game.spin || null;
  spinState.pending = false;
  renderSpinGame();
}

function secureWheelRandom(max) {
  const value = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  do crypto.getRandomValues(value); while (value[0] >= limit);
  return value[0] % max;
}

function drawWheel(canvas, items) {
  const context = canvas.getContext("2d");
  const size = 800;
  canvas.width = size; canvas.height = size;
  context.translate(400, 400);
  const step = Math.PI * 2 / items.length;
  const colors = ["#ffffff", "#f2f3f7", "#e5e9ff"];
  items.forEach((name, index) => {
    const start = -Math.PI / 2 + index * step;
    context.beginPath(); context.moveTo(0, 0);
    for (let i = 0; i <= 70; i += 1) {
      const angle = start + i * step / 70;
      const radius = 383 + Math.sin(angle * 29) * 1.1 + Math.sin(angle * 53) * .7;
      context.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    context.closePath();
    context.fillStyle = colors[index % colors.length]; context.fill();
    context.lineWidth = 4; context.lineJoin = "round"; context.strokeStyle = "#111111"; context.stroke();
    context.save(); context.rotate(start + step / 2); context.translate(245, 0); context.rotate(Math.PI / 2);
    context.font = `${items.length > 12 ? 27 : items.length > 6 ? 36 : items.length > 2 ? 48 : 60}px MemomentKkukkukk, sans-serif`;
    context.fillStyle = "#111111"; context.textAlign = "center"; context.textBaseline = "middle";
    const maxWidth = Math.min(220, 390 * Math.sin(Math.min(step / 2, Math.PI / 3)));
    let label = name;
    while (label.length > 1 && context.measureText(label).width > maxWidth) label = label.slice(0, -1);
    if (label !== name) label = label.slice(0, -1) + "…";
    context.fillText(label, 0, 0); context.restore();
  });
}

function renderSpinStage() {
  cancelAnimationFrame(spinFrame);
  const stage = document.querySelector(".theme-roulette .result-stage-wrap");
  if (!stage) return;
  const items = wheelItems();
  if (items.length < 2) {
    stage.innerHTML = emptyResult("./assets/game/roulette-empty.svg", "돌림판이 비었어요", "항목을 두 개 이상 추가한 뒤 돌려주세요!");
    return;
  }
  stage.innerHTML = `<div class="wheel-stage"><div class="wheel-frame"><span class="wheel-pointer" aria-hidden="true"></span><canvas role="img" aria-label="${escapeHtml(items.join(', '))} 항목이 있는 돌림판"></canvas><span class="wheel-hub" aria-hidden="true"></span></div><p class="wheel-caption" role="status" aria-live="polite"></p></div>`;
  const canvas = stage.querySelector("canvas");
  const caption = stage.querySelector(".wheel-caption");
  const pointer = stage.querySelector(".wheel-pointer");
  drawWheel(canvas, items);
  document.fonts.ready.then(() => { if (canvas.isConnected) drawWheel(canvas, items); });
  const spin = spinState.spin;
  if (!spin) { caption.textContent = "준비됐나요? 돌림판을 돌려주세요!"; return; }
  const angle = spin.turns * 360 + 360 - (spin.winner_index + .5) * 360 / items.length;
  let previousSector = -1;
  caption.textContent = "두근두근… 어디서 멈출까요?";
  const animate = () => {
    if (!canvas.isConnected || spinState.spin !== spin) return;
    const progress = clamp((spinNow() - spin.started_at_ms) / spin.duration_ms, 0, 1);
    // Quartic ease-out has continuously declining velocity and a suspenseful final crawl.
    const rotation = angle * (1 - Math.pow(1 - progress, 4));
    canvas.style.transform = `rotate(${reducedMotion ? (progress === 1 ? angle : 0) : rotation}deg)`;
    const sector = Math.floor(rotation / (360 / items.length));
    if (!reducedMotion && sector !== previousSector) {
      pointer.classList.remove("is-ticking");
      void pointer.offsetWidth;
      pointer.classList.add("is-ticking");
      previousSector = sector;
    }
    if (progress < 1) spinFrame = requestAnimationFrame(animate);
    else {
      caption.innerHTML = `짠! 오늘의 당첨은<strong>${escapeHtml(items[spin.winner_index])}</strong>`;
      caption.classList.add("is-winner");
      canvas.setAttribute("aria-label", `당첨 결과: ${items[spin.winner_index]}`);
      document.querySelectorAll(".theme-roulette input").forEach(input => { input.disabled = isGuest(); });
      document.querySelectorAll(".theme-roulette [data-count-step]").forEach(button => {
        button.disabled = isGuest() || (Number(button.dataset.countStep) < 0 ? spinState.items.length <= 2 : spinState.items.length >= 24);
      });
      const label = document.querySelector("[data-spin-wheel] > span");
      if (label) label.textContent = "한 번 더 돌려!";
      updateSpinButton();
    }
  };
  animate();
}

document.addEventListener("betya-game-error", () => {
  spinState.pending = false;
  if (document.querySelector(".theme-roulette")) renderSpinGame();
});
