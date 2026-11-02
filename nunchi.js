let nunchiClock = null;
let nunchiOffset = 0;
let nunchiSent = null;
let nunchiStarting = false;

function renderNunchiGame() {
  clearInterval(nunchiClock);
  const snapshot = window.BetyaRoom.state();
  const round = snapshot?.game?.type === "nunchi" ? snapshot.game.nunchi : null;
  const members = snapshot?.players || [];
  const me = snapshot?.you?.player_id;
  const host = window.BetyaRoom.isHost();
  const connected = members.filter(player => player.status === "connected");
  const active = round && ["countdown", "playing"].includes(round.phase);
  const mine = round?.claims.find(claim => claim.player_id === me);
  const participant = round?.participant_ids.includes(me);
  const number = (round?.claims.length || 0) + 1;
  const name = id => escapeHtml(round?.names[id] || members.find(player => player.player_id === id)?.nickname || "퇴장한 참가자");
  const result = round?.result;
  const status = player => {
    const claim = round?.claims.find(item => item.player_id === player.player_id);
    if (result?.loser_ids.includes(player.player_id)) return "걸렸다!";
    if (claim) return `${claim.number} 성공`;
    if (player.status !== "connected") return "연결 대기";
    if (active && !round.participant_ids.includes(player.player_id)) return "다음 라운드";
    return active ? "눈치 보는 중" : "준비 완료";
  };
  const setup = `<div class="nunchi-member-heading"><span>함께 눈치 보는 사람</span><strong>${connected.length}명</strong></div>
    <div class="nunchi-members">${members.map(player => `<div class="nunchi-member ${result?.loser_ids.includes(player.player_id) ? "is-loser" : ""}"><span>${escapeHtml(player.nickname)}${player.player_id === me ? ' <small>나</small>' : ""}</span><span>${status(player)}</span></div>`).join("")}</div>
    <details class="nunchi-rules"><summary>어떻게 해요?</summary><p>1부터 순서대로, 각자 딱 한 번 눌러요.<br>같은 숫자에서 0.3초 안에 겹치면 함께 패배!<br>마지막 한 명도 패배해요. 15초 동안 아무도 누르지 않으면 남은 사람이 모두 걸려요.</p></details>`;
  let stage;
  if (!round) stage = '<p class="nunchi-caption">방에 연결하는 중이에요…</p>';
  else if (result) {
    const title = { collision: `${result.number}에서 겹쳤다!`, last: "너무 오래 눈치 봤다!", timeout: "시간 초과!", cancelled: "잠깐, 누가 나갔어요" }[result.reason];
    stage = `<div class="nunchi-result" role="status"><span class="nunchi-kicker">${result.reason === "cancelled" ? "라운드 중단" : "이번에 걸린 사람"}</span><h2>${title}</h2><strong>${result.loser_ids.map(name).join(", ") || "다시 모여서 시작해요"}</strong><p>${result.reason === "collision" ? "눈치가 너무 잘 통했네~" : result.reason === "last" ? "마지막까지 남으면 걸려요~" : result.reason === "timeout" ? "아무도 안 누르면 같이 걸려요~" : "참가자가 나가거나 연결이 끊겨 라운드를 멈췄어요."}</p></div>`;
  } else if (active) {
    stage = `<div class="nunchi-play"><span class="nunchi-kicker" data-nunchi-kicker>준비…</span><button class="nunchi-tap" type="button" data-nunchi-tap disabled aria-label="${number} 외치기"><span data-nunchi-number>${number}</span></button><p class="nunchi-caption" data-nunchi-caption></p><span class="nunchi-time" data-nunchi-time></span></div>`;
  } else {
    stage = '<div class="nunchi-waiting"><img src="./assets/home/catalog-nunchi.svg" alt="" /><h2>누를까? 말까?</h2><p>겹쳐도, 마지막까지 남아도 걸려요.</p><span>각자 자기 화면에서 참여해요 · 2~12명</span></div>';
  }
  const canStart = round && !active && connected.length >= 2 && !nunchiStarting;
  const action = host && !active ? `<button class="primary-button" type="button" data-nunchi-start ${canStart ? "" : "disabled"}><span>${result ? "한 판 더!" : "눈치게임 시작"}</span></button>` : "";
  pageShell("nunchi", "눈치게임", "겹치면 걸린다! 눈치껏 한 번만 눌러요", setup, stage, action);
  if (!active && !host && !result) document.querySelector(".nunchi-waiting")?.insertAdjacentHTML("beforeend", '<span>방장이 시작하기를 기다리고 있어요.</span>');
  if (!active && connected.length < 2) document.querySelector(".result-stage-wrap")?.insertAdjacentHTML("beforeend", '<p class="nunchi-caption">친구가 들어오면 시작할 수 있어요.</p>');
  document.querySelector("[data-nunchi-start]")?.addEventListener("click", () => {
    nunchiStarting = window.BetyaRoom.send("game.nunchi.start", { round: round.round });
    if (nunchiStarting) renderNunchiGame();
    else toast("방 연결을 확인해주세요.");
  });
  const tap = document.querySelector("[data-nunchi-tap]");
  tap?.addEventListener("click", () => {
    if (tap.disabled) return;
    if (window.BetyaRoom.send("game.nunchi.tap", { round: round.round, number })) {
      nunchiSent = { round: round.round, number };
      updateClock();
    } else toast("방 연결을 확인해주세요.");
  });
  function updateClock() {
    if (!tap?.isConnected) { clearInterval(nunchiClock); return; }
    const now = Date.now() + nunchiOffset;
    const countdown = round.phase === "countdown" || now < round.starts_at_ms;
    const sent = nunchiSent?.round === round.round || round.your_tap_pending;
    tap.disabled = countdown || !participant || Boolean(mine) || sent || now >= round.deadline_ms;
    document.querySelector("[data-nunchi-number]").textContent = countdown ? Math.max(1, Math.ceil((round.starts_at_ms - now) / 1000)) : number;
    document.querySelector("[data-nunchi-kicker]").textContent = countdown ? "곧 시작해요" : `${number} 외칠 사람?`;
    document.querySelector("[data-nunchi-caption]").textContent = !participant ? "다음 라운드부터 함께해요." : mine ? `${mine.number} 성공! 이제 구경해요.` : sent ? "눌렀다! 겹쳤을까…?" : countdown ? "시작하면 딱 한 번 눌러요." : "지금? 조금만 더 기다릴까?";
    document.querySelector("[data-nunchi-time]").textContent = countdown ? "" : `${Math.max(0, Math.ceil((round.deadline_ms - now) / 1000))}초 안에 누군가 눌러야 해요`;
  }
  if (active) { updateClock(); nunchiClock = setInterval(updateClock, 100); }
}

function applyNunchiGame(detail) {
  if (Number.isFinite(detail?.payload?.server_time_ms)) nunchiOffset = detail.payload.server_time_ms - Date.now();
  if (detail?.type === "game.snapshot") nunchiSent = null;
  nunchiStarting = false;
  if (currentRoute() === "nunchi") renderNunchiGame();
}

document.addEventListener("betya-room-members", () => { if (location.hash === "#nunchi") renderNunchiGame(); });
document.addEventListener("betya-game-error", () => { nunchiSent = null; nunchiStarting = false; if (location.hash === "#nunchi") renderNunchiGame(); });
window.addEventListener("hashchange", () => { if (location.hash !== "#nunchi") clearInterval(nunchiClock); });
