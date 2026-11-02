let bombClock = null;
let bombOffset = 0;
let bombPending = false;
let bombResize = null;
let bombFlight = null;
let bombVisual = null;
let bombRoster = "";
let bombBoardSize = 0;

function bombAvatar(playerId) {
  let index = 0;
  for (const character of playerId) index = (index * 31 + character.charCodeAt(0)) >>> 0;
  const colors = ["#e9eeff", "#fff0d8", "#e4f3ec", "#fce5eb", "#eee5fa", "#e0f0f7"];
  const hair = ["M17 24q2-17 15-15 14-2 17 15", "M16 24 20 12l8 3 5-7 6 7 8-1 3 13", "M16 25q-2-13 9-15m0 0q4-8 10 0m0 0q15-4 15 16", "M16 24q5-16 16-15 9 0 18 16"];
  return `<svg class="bomb-avatar" viewBox="0 0 64 64" aria-hidden="true"><path d="M8 60q1-18 24-18 23 0 24 18" fill="${colors[index % colors.length]}" stroke="#111" stroke-width="2"/><path d="M16 26q-1-16 16-16 18 0 17 17l-1 9q-2 14-16 15-14-1-16-15Z" fill="#fff" stroke="#111" stroke-width="2"/><path d="${hair[index % hair.length]}" fill="none" stroke="#111" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><g class="bomb-face-normal" fill="none" stroke="#111" stroke-width="2.5" stroke-linecap="round"><path d="M25 29v3m14-3v3"/><path d="M27 39q5 5 10 0"/></g><g class="bomb-face-scared" fill="none" stroke="#111" stroke-width="2.5" stroke-linecap="round"><path d="m23 24 5 2m8 0 5-2M25 30v4m14-4v4"/><ellipse cx="32" cy="41" rx="3" ry="4"/></g><g class="bomb-face-out" fill="none" stroke="#111" stroke-width="2.5" stroke-linecap="round"><path d="m22 28 7 7m0-7-7 7m13-7 7 7m0-7-7 7M27 43q5-4 10 0"/></g></svg>`;
}

function bombSeat(index, count, myIndex) {
  const angle = (index - Math.max(0, myIndex)) * Math.PI * 2 / count + (myIndex < 0 ? -Math.PI / 2 : Math.PI / 2);
  return { x: 50 + Math.cos(angle) * 35, y: 50 + Math.sin(angle) * 35 };
}

function mountBombBoard() {
  pageShell("bomb", "폭탄 돌리기", "터지기 전에 친구에게 넘겨요", "", `
    <div class="bomb-board-header"><span class="bomb-player-count" data-bomb-count></span><details class="bomb-help"><summary aria-label="게임 방법">?</summary><p>폭탄을 받으면 원 안의 친구를 눌러요.<br>받은 뒤 0.7초만 기다리면 넘길 수 있어요.<br>터질 때 가진 사람이 걸려요!</p></details></div>
    <div class="bomb-arena-wrap"><div class="bomb-arena" aria-label="참가자와 폭탄" data-bomb-arena>
      <svg class="bomb-table" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 15C70 14 85 30 85 50S70 86 50 85 14 71 15 50 29 14 50 15Z"/><circle cx="50" cy="50" r="25"/></svg>
      <div class="bomb-center" data-bomb-center><span data-bomb-countdown></span><strong data-bomb-outcome></strong><span data-bomb-center-caption></span></div>
      <svg class="bomb-trail" data-bomb-trail aria-hidden="true"><path/></svg>
      <div class="bomb-players" data-bomb-players></div>
      <div class="bomb-token" data-bomb-token aria-hidden="true"><div class="bomb-token-art"><img src="./assets/game/bomb-token.svg" alt="" /></div></div>
    </div></div>
    <p class="sr-only" role="status" data-bomb-announcement></p>`, `
    <div class="bomb-footer"><p class="bomb-caption" data-bomb-caption></p><button class="primary-button" type="button" data-bomb-start hidden><span>폭탄 돌리기 시작</span></button></div>`);
  document.querySelector(".theme-bomb .game-settings-frame").remove();
  bombRoster = "";
  bombBoardSize = 0;
  document.querySelector("[data-bomb-start]").addEventListener("click", () => {
    const round = window.BetyaRoom.state()?.game?.bomb;
    if (!round || bombPending) return;
    bombPending = window.BetyaRoom.send("game.bomb.start", { round: round.round });
    if (bombPending) renderBombGame();
    else toast("방 연결을 확인해주세요.");
  });
  document.querySelector("[data-bomb-players]").addEventListener("click", event => {
    const button = event.target.closest("[data-bomb-target]");
    if (!button || button.disabled || bombPending) return;
    const round = window.BetyaRoom.state()?.game?.bomb;
    if (!round) return;
    bombPending = window.BetyaRoom.send("game.bomb.pass", { player_id: button.dataset.bombTarget, round: round.round, turn: round.turn });
    if (bombPending) updateBombClock();
    else toast("방 연결을 확인해주세요.");
  });
  bombResize?.disconnect();
  bombResize = new ResizeObserver(() => {
    const size = document.querySelector("[data-bomb-arena]")?.getBoundingClientRect().width;
    if (size && Math.abs(size - bombBoardSize) > 0.5) positionBomb(false);
  });
  bombResize.observe(document.querySelector("[data-bomb-arena]"));
}

function renderBombGame(detail) {
  clearInterval(bombClock);
  if (!document.querySelector("[data-bomb-arena]")) mountBombBoard();
  const snapshot = window.BetyaRoom.state();
  const round = snapshot?.game?.type === "bomb" ? snapshot.game.bomb : null;
  const members = snapshot?.players || [];
  const me = snapshot?.you?.player_id;
  const connected = members.filter(player => player.status === "connected");
  const active = round && ["countdown", "playing"].includes(round.phase);
  const ids = round && round.phase !== "waiting" ? [...round.participant_ids] : members.map(player => player.player_id);
  if (round?.result?.loser_id && !ids.includes(round.result.loser_id)) ids.push(round.result.loser_id);
  const myIndex = ids.indexOf(me);
  const arena = document.querySelector("[data-bomb-arena]");
  arena.classList.toggle("is-crowded", ids.length > 8);
  arena.classList.toggle("is-playing", round?.phase === "playing");
  arena.classList.toggle("is-finished", Boolean(round?.result));
  arena.classList.toggle("is-countdown", round?.phase === "countdown");
  arena.classList.toggle("is-mine", Boolean(active && round.holder_id === me));
  const roster = ids.join(",");
  const list = document.querySelector("[data-bomb-players]");
  if (bombRoster !== roster) {
    list.innerHTML = ids.map((id, index) => `<button class="bomb-player" type="button" data-bomb-player="${escapeHtml(id)}" disabled><span class="bomb-avatar-frame">${bombAvatar(id)}<span class="bomb-me-tag" aria-hidden="true">나</span><svg class="bomb-explosion" viewBox="0 0 100 100" aria-hidden="true"><path d="m50 5 9 20 20-14-3 24 22 1-16 17 14 18-24 1 2 24-23-14-15 17-4-24-24 6 12-22L2 47l24-8-10-21 23 9Z"/></svg></span><span class="bomb-player-name"></span></button>`).join("");
    bombRoster = roster;
  }
  list.querySelectorAll("[data-bomb-player]").forEach((button, index) => {
    const id = button.dataset.bombPlayer;
    const member = members.find(player => player.player_id === id);
    const name = round?.names[id] || member?.nickname || "퇴장한 참가자";
    const seat = bombSeat(index, ids.length, myIndex);
    button.style.left = `${seat.x}%`;
    button.style.top = `${seat.y}%`;
    button.classList.toggle("is-me", id === me);
    button.classList.toggle("is-holder", Boolean(active && id === round.holder_id));
    button.classList.toggle("is-offline", member?.status !== "connected");
    button.classList.toggle("is-out", round?.result?.loser_id === id);
    button.classList.toggle("is-target", Boolean(active && round.holder_id === me && id !== me && member?.status === "connected"));
    button.querySelector(".bomb-player-name").textContent = name;
    button.title = name;
    button.setAttribute("aria-label", active && id !== me ? `${name}에게 폭탄 넘기기` : `${name}${id === me ? ", 나" : ""}${active && id === round.holder_id ? ", 폭탄 보유 중" : ""}`);
    if (active && id !== me && round.participant_ids.includes(id)) button.dataset.bombTarget = id;
    else delete button.dataset.bombTarget;
  });
  document.querySelector("[data-bomb-count]").textContent = `${active ? ids.length : connected.length}명`;
  const start = document.querySelector("[data-bomb-start]");
  start.hidden = !window.BetyaRoom.isHost() || Boolean(active);
  start.disabled = !round || connected.length < 2 || bombPending;
  start.querySelector("span").textContent = round?.result ? "한 판 더!" : "폭탄 돌리기 시작";
  const outcome = document.querySelector("[data-bomb-outcome]");
  const result = round?.result;
  outcome.textContent = result ? result.loser_id ? `${round.names[result.loser_id]} 걸렸다!` : "다시 모여요" : "";
  document.querySelector("[data-bomb-center-caption]").textContent = result ? `${round.turn}번 넘겼어요` : !active ? "동그랗게 모여요" : "";
  const announcement = !round ? "방에 연결하는 중이에요." : result ? outcome.textContent : active ? `${round.names[round.holder_id]}님이 폭탄을 가지고 있어요.` : "친구가 모이면 시작해요.";
  if (document.querySelector("[data-bomb-announcement]").textContent !== announcement) document.querySelector("[data-bomb-announcement]").textContent = announcement;
  const canAnimate = detail?.type !== "game.snapshot" && bombVisual?.room === snapshot?.room?.code && bombVisual?.round === round?.round && bombVisual?.turn !== round?.turn && round?.phase === "playing";
  positionBomb(canAnimate, detail?.type !== "game.snapshot");
  bombVisual = round ? { room: snapshot.room.code, round: round.round, turn: round.turn, holder: round.holder_id, phase: round.phase } : null;
  updateBombClock();
  if (active) bombClock = setInterval(updateBombClock, 80);
}

function positionBomb(animate, preserveFlight = false) {
  const arena = document.querySelector("[data-bomb-arena]");
  const token = document.querySelector("[data-bomb-token]");
  if (!arena || !token) return;
  const round = window.BetyaRoom.state()?.game?.bomb;
  const bounds = arena.getBoundingClientRect();
  if (preserveFlight && !animate && !round?.result && bombFlight?.playState === "running" && bombVisual?.round === round?.round && bombVisual?.holder === round?.holder_id && Math.abs(bounds.width - bombBoardSize) < 0.5) return;
  bombBoardSize = bounds.width;
  const holder = Array.from(arena.querySelectorAll("[data-bomb-player]")).find(button => button.dataset.bombPlayer === round?.holder_id);
  const target = { x: bounds.width / 2, y: bounds.height / 2 };
  if (holder && round?.phase !== "waiting") {
    target.x += (parseFloat(holder.style.left) / 100 - 0.5) * bounds.width * 0.66;
    target.y += (parseFloat(holder.style.top) / 100 - 0.5) * bounds.height * 0.66;
  }
  const previous = token.getBoundingClientRect();
  const start = { x: previous.x - bounds.x, y: previous.y - bounds.y };
  bombFlight?.cancel();
  token.style.transform = `translate(${target.x}px, ${target.y}px)`;
  token.hidden = Boolean(round?.result);
  if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches || Math.hypot(start.x - target.x, start.y - target.y) < 1) return;
  const control = { x: (start.x + target.x) / 2 - (target.y - start.y) * 0.2, y: (start.y + target.y) / 2 + (target.x - start.x) * 0.2 };
  const frames = Array.from({ length: 21 }, (_, index) => {
    const t = index / 20, rest = 1 - t;
    const x = rest * rest * start.x + 2 * rest * t * control.x + t * t * target.x;
    const y = rest * rest * start.y + 2 * rest * t * control.y + t * t * target.y;
    return { transform: `translate(${x}px, ${y}px) rotate(${Math.sin(t * Math.PI) * 35}deg) scale(${1 + Math.sin(t * Math.PI) * 0.2})`, offset: t };
  });
  bombFlight = token.animate(frames, { duration: 440, easing: "cubic-bezier(.25,.1,.25,1)" });
  const trail = document.querySelector("[data-bomb-trail]");
  trail.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
  trail.querySelector("path").setAttribute("d", `M${start.x} ${start.y} Q${control.x} ${control.y} ${target.x} ${target.y}`);
  trail.getAnimations().forEach(animation => animation.cancel());
  trail.animate([{ opacity: 0 }, { opacity: 0.6, offset: 0.2 }, { opacity: 0 }], { duration: 650 });
}

function updateBombClock() {
  const arena = document.querySelector("[data-bomb-arena]");
  if (!arena?.isConnected) { clearInterval(bombClock); return; }
  const snapshot = window.BetyaRoom.state();
  const round = snapshot?.game?.bomb;
  const now = Date.now() + bombOffset;
  const me = snapshot?.you?.player_id;
  const countdown = round?.phase === "countdown" || now < round?.starts_at_ms;
  const mine = round?.phase === "playing" && round.holder_id === me;
  const cooldown = now < round?.pass_available_at_ms;
  arena.style.setProperty("--cooldown", Math.max(0, Math.min(1, 1 - ((round?.pass_available_at_ms || 0) - now) / 700)));
  const countdownLabel = document.querySelector("[data-bomb-countdown]");
  const count = countdown ? String(Math.max(1, Math.ceil((round.starts_at_ms - now) / 1000))) : "";
  if (countdownLabel.textContent !== count) countdownLabel.textContent = count;
  arena.querySelectorAll("[data-bomb-player]").forEach(button => {
    button.disabled = !mine || !button.classList.contains("is-target") || cooldown || bombPending;
  });
  const result = round?.result;
  const caption = !round ? "방에 연결하는 중이에요…" : result ? result.reason === "left" ? "폭탄을 가진 채 나가면 걸려요~" : result.reason === "cancelled" ? "친구가 두 명 이상 필요해요." : "조금만 더 빨리 넘길걸~" : countdown ? "준비…" : mine ? bombPending ? "" : cooldown ? "앗, 뜨거!" : "넘길 친구를 눌러요!" : round.phase === "playing" ? round.participant_ids.includes(me) ? "나한테 오지 마…!" : "다음 판에 함께해요." : snapshot.players.filter(player => player.status === "connected").length < 2 ? "친구가 들어오면 시작해요." : window.BetyaRoom.isHost() ? "다 모였으면 시작!" : "방장이 시작하기를 기다려요.";
  const label = document.querySelector("[data-bomb-caption]");
  if (label.textContent !== caption) label.textContent = caption;
}

function applyBombGame(detail) {
  if (Number.isFinite(detail?.payload?.server_time_ms)) bombOffset = detail.payload.server_time_ms - Date.now();
  bombPending = false;
  if (currentRoute() === "bomb") renderBombGame(detail);
}

document.addEventListener("betya-room-members", () => { if (location.hash === "#bomb") renderBombGame(); });
document.addEventListener("betya-game-error", () => { bombPending = false; if (location.hash === "#bomb") renderBombGame(); });
window.addEventListener("hashchange", () => {
  if (location.hash === "#bomb") return;
  clearInterval(bombClock);
  bombResize?.disconnect();
  bombFlight?.cancel();
  bombVisual = null;
});
