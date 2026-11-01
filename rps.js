/* Each participant chooses privately; the server owns rounds and elimination. */
let rpsPending = false;
const rpsLabels = { scissors: "가위", rock: "바위", paper: "보" };

function renderRpsGame() {
  const snapshot = window.BetyaRoom.state();
  const game = snapshot?.game?.type === "rps" ? snapshot.game : null;
  const round = game?.rps;
  const members = snapshot?.players || [];
  const me = snapshot?.you?.player_id || window.BetyaRoom.session()?.playerId;
  const host = window.BetyaRoom.isHost();
  const active = round?.active_ids || [];
  const selected = round?.selected_ids || [];
  const choosing = round?.phase === "choosing";
  const canChoose = choosing && active.includes(me) && !rpsPending;
  const name = id => members.find(player => player.player_id === id)?.nickname || "퇴장한 참가자";
  const result = round?.result;
  const status = id => {
    if (result?.choices?.[id]) return rpsLabels[result.choices[id]];
    if (!active.includes(id)) return "대기";
    return selected.includes(id) ? "선택 완료" : "선택 안 함";
  };
  const setup = `<div class="rps-count"><span>참여 인원</span><strong>${active.length}명</strong></div>
    <div class="rps-members">${members.map(player => `<div class="rps-member"><span>${escapeHtml(player.nickname)}</span><span class="rps-member-status ${selected.includes(player.player_id) ? "is-ready" : ""}">${choosing && selected.includes(player.player_id) ? '<img src="./assets/rps/check.svg" alt="" />' : ""}${status(player.player_id)}</span></div>`).join("")}</div>`;
  const choices = `<div class="rps-board"><div class="rps-board-canvas">${Object.entries(rpsLabels).map(([choice, label]) => `<button type="button" class="rps-choice rps-choice--${choice}${round?.your_choice === choice ? " is-selected" : ""}" data-rps-choice="${choice}" aria-label="${label}" aria-pressed="${round?.your_choice === choice}" ${canChoose ? "" : "disabled"}><img src="./assets/rps/${choice}.svg" alt="" /></button>`).join("")}</div></div>`;
  const summary = !round ? "방에 연결하는 중이에요…"
    : active.length < 2 ? "다른 참가자를 기다리고 있어요." : !active.includes(me) ? "다음 게임을 기다리고 있어요." : "";
  const drawChoices = `<div class="rps-board rps-board--draw" aria-hidden="true"><div class="rps-board-canvas">${Object.keys(rpsLabels).map(choice => `<span class="rps-choice rps-choice--${choice}"><img src="./assets/rps/${choice}.svg" alt="" /></span>`).join("")}</div></div>`;
  const outcome = result
    ? `<div class="rps-outcome" role="status"><h2>${result.draw ? "무승부! 다시 선택해주세요" : `${result.loser_ids.map(id => escapeHtml(name(id))).join(", ")} 패배!`}</h2>${result.draw ? drawChoices : ""}</div>`
    : `${choices}<div class="rps-summary" role="status">${summary}</div>`;
  const actionName = round?.phase === "finished" ? "다시하기" : round?.phase === "revealed" ? "다음 라운드" : "가위바위보~!";
  const ready = round && !rpsPending && (!choosing || (active.length >= 2 && active.every(id => selected.includes(id))));
  const action = host ? `<button class="primary-button" data-rps-action type="button" ${ready ? "" : "disabled"}><span>${actionName}</span></button>` : "";
  pageShell("rps", "가위바위보", "가위, 바위, 보 중 하나를 골라주세요", setup, outcome, action);
  document.querySelector(".theme-rps").classList.toggle("rps-guest", !host);
  document.querySelectorAll("[data-rps-choice]").forEach(button => button.addEventListener("click", () => {
    if (!canChoose) return;
    rpsPending = window.BetyaRoom.send("game.rps.choose", { choice: button.dataset.rpsChoice, round: round.round });
    if (rpsPending) renderRpsGame();
    else toast("방 연결을 확인해주세요.");
  }));
  document.querySelector("[data-rps-action]")?.addEventListener("click", () => {
    if (!host || !ready) return;
    const event = round.phase === "finished" ? "game.reset" : round.phase === "revealed" ? "game.rps.next" : "game.rps.reveal";
    rpsPending = window.BetyaRoom.send(event, { round: round.round });
    if (rpsPending) renderRpsGame();
    else toast("방 연결을 확인해주세요.");
  });
}

function applyRpsGame() {
  rpsPending = false;
  if (currentRoute() === "rps") renderRpsGame();
}
document.addEventListener("betya-room-members", () => { if (location.hash === "#rps") renderRpsGame(); });
document.addEventListener("betya-game-error", () => { if (location.hash === "#rps") applyRpsGame(); });
