let bombClock = null;
let bombOffset = 0;
let bombPending = false;

function renderBombGame() {
  clearInterval(bombClock);
  const snapshot = window.BetyaRoom.state();
  const round = snapshot?.game?.type === "bomb" ? snapshot.game.bomb : null;
  const members = snapshot?.players || [];
  const me = snapshot?.you?.player_id;
  const host = window.BetyaRoom.isHost();
  const connected = members.filter(player => player.status === "connected");
  const active = round && ["countdown", "playing"].includes(round.phase);
  const mine = round?.holder_id === me;
  const name = id => escapeHtml(round?.names[id] || members.find(player => player.player_id === id)?.nickname || "퇴장한 참가자");
  const result = round?.result;
  const status = player => {
    if (result?.loser_id === player.player_id) return "펑! 걸렸다";
    if (active && player.player_id === round.holder_id) return "폭탄 보유 중";
    if (player.status !== "connected") return "연결 대기";
    if (active && !round.participant_ids.includes(player.player_id)) return "다음 라운드";
    return active ? "나한테 오지 마!" : "준비 완료";
  };
  const setup = `<div class="bomb-member-heading"><span>같이 폭탄 돌리는 사람</span><strong>${connected.length}명</strong></div>
    <div class="bomb-members">${members.map(player => `<div class="bomb-member ${active && player.player_id === round.holder_id ? "is-holder" : ""} ${result?.loser_id === player.player_id ? "is-loser" : ""}"><span>${escapeHtml(player.nickname)}${player.player_id === me ? ' <small>나</small>' : ""}</span><span>${status(player)}</span></div>`).join("")}</div>
    <details class="bomb-rules"><summary>어떻게 해요?</summary><p>폭탄을 받으면 넘길 사람을 눌러요.<br>받은 뒤 0.7초 동안은 넘길 수 없어요.<br>언제 터질지는 비밀! 터질 때 가진 사람이 패배해요. 폭탄을 가진 채 나가도 걸려요.</p></details>`;
  let stage;
  if (!round) stage = '<p class="bomb-caption">방에 연결하는 중이에요…</p>';
  else if (result) {
    stage = `<div class="bomb-result" role="status"><span class="bomb-kicker">${result.reason === "cancelled" ? "라운드 중단" : "이번에 걸린 사람"}</span><span class="bomb-burst" aria-hidden="true">${result.reason === "cancelled" ? "…" : "펑!"}</span><h2>${result.loser_id ? `${name(result.loser_id)} 걸렸다!` : "다시 모여서 시작해요"}</h2><p>${result.reason === "left" ? "폭탄을 가진 채 방을 나갔어요." : result.reason === "cancelled" ? "참가자가 부족해서 라운드를 멈췄어요." : "조금만 더 빨리 넘길걸~"}</p><span>이번 판 ${round.turn}번 넘겼어요</span></div>`;
  } else if (active) {
    const targets = round.participant_ids.filter(id => id !== me && connected.some(player => player.player_id === id));
    stage = `<div class="bomb-play ${mine ? "is-mine" : ""}"><span class="bomb-kicker" data-bomb-kicker>곧 시작해요</span><div class="bomb-art"><img src="./assets/home/catalog-bomb.svg" alt="" /><span data-bomb-countdown></span></div><h2>${mine ? "내 손에 폭탄!" : `${name(round.holder_id)} 손에 폭탄!`}</h2><p class="bomb-caption" data-bomb-caption></p>${mine ? `<div class="bomb-targets" aria-label="폭탄을 넘길 사람">${targets.map(id => `<button type="button" data-bomb-target="${escapeHtml(id)}" disabled><span>${name(id)}</span><span aria-hidden="true">↗</span></button>`).join("")}</div>` : `<span class="bomb-watch">${round.participant_ids.includes(me) ? "제발 나한테 오지 마…" : "다음 라운드부터 함께해요."}</span>`}</div>`;
  } else {
    stage = '<div class="bomb-waiting"><img src="./assets/home/catalog-bomb.svg" alt="" /><h2>받았으면 빨리 넘겨!</h2><p>언제 터질지는 아무도 몰라요.</p><span>각자 자기 화면에서 참여해요 · 2~12명</span></div>';
  }
  const canStart = round && !active && connected.length >= 2 && !bombPending;
  const action = host && !active ? `<button class="primary-button" type="button" data-bomb-start ${canStart ? "" : "disabled"}><span>${result ? "한 판 더!" : "폭탄 돌리기 시작"}</span></button>` : "";
  pageShell("bomb", "폭탄 돌리기", "나한테서 터지면 안 돼! 친구에게 넘겨요", setup, stage, action);
  if (!active && !host && !result) document.querySelector(".bomb-waiting")?.insertAdjacentHTML("beforeend", '<span>방장이 시작하기를 기다리고 있어요.</span>');
  if (!active && connected.length < 2) document.querySelector(".result-stage-wrap")?.insertAdjacentHTML("beforeend", '<p class="bomb-caption">친구가 들어오면 시작할 수 있어요.</p>');
  document.querySelector("[data-bomb-start]")?.addEventListener("click", () => {
    bombPending = window.BetyaRoom.send("game.bomb.start", { round: round.round });
    if (bombPending) renderBombGame();
    else toast("방 연결을 확인해주세요.");
  });
  document.querySelectorAll("[data-bomb-target]").forEach(button => button.addEventListener("click", () => {
    if (button.disabled) return;
    bombPending = window.BetyaRoom.send("game.bomb.pass", { player_id: button.dataset.bombTarget, round: round.round, turn: round.turn });
    if (bombPending) updateClock();
    else toast("방 연결을 확인해주세요.");
  }));
  function updateClock() {
    const play = document.querySelector(".bomb-play");
    if (!play?.isConnected) { clearInterval(bombClock); return; }
    const now = Date.now() + bombOffset;
    const countdown = round.phase === "countdown" || now < round.starts_at_ms;
    const cooldown = now < round.pass_available_at_ms;
    play.classList.toggle("is-ticking", !countdown);
    document.querySelector("[data-bomb-countdown]").textContent = countdown ? Math.max(1, Math.ceil((round.starts_at_ms - now) / 1000)) : "";
    document.querySelector("[data-bomb-kicker]").textContent = countdown ? "곧 시작해요" : `째깍째깍… ${round.turn}번 넘겼어요`;
    document.querySelector("[data-bomb-caption]").textContent = countdown ? "처음 받을 사람은 랜덤이에요." : !mine ? "누구에게 넘어갈까요?" : bombPending ? "넘기는 중…" : cooldown ? "앗 뜨거! 잠깐만 기다려요…" : "빨리! 넘길 사람을 눌러요.";
    document.querySelectorAll("[data-bomb-target]").forEach(button => { button.disabled = countdown || cooldown || bombPending; });
  }
  if (active) { updateClock(); bombClock = setInterval(updateClock, 100); }
}

function applyBombGame(detail) {
  if (Number.isFinite(detail?.payload?.server_time_ms)) bombOffset = detail.payload.server_time_ms - Date.now();
  bombPending = false;
  if (currentRoute() === "bomb") renderBombGame();
}

document.addEventListener("betya-room-members", () => { if (location.hash === "#bomb") renderBombGame(); });
document.addEventListener("betya-game-error", () => { bombPending = false; if (location.hash === "#bomb") renderBombGame(); });
window.addEventListener("hashchange", () => { if (location.hash !== "#bomb") clearInterval(bombClock); });
