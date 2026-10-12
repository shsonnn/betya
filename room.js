(() => {
  const STORAGE_KEY = "betya.room.session";
  const GAME_PATHS = {
    dice: "./dice.html",
    pick: "./index.html#pick",
    team: "./index.html#team",
  };
  const EMOJIS = [
    ["shotgun", "샷건"], ["not-me", "나만 아니면 돼"], ["winner", "이겨서 기분 좋음"],
    ["despair", "절망"], ["drool", "군침이 싹"], ["minus-100m", "-1억"],
    ["scream", "끼야호"], ["huh", "엥?"], ["oh", "오~"], ["close", "까비"],
  ];

  let socket = null;
  let session = readSession();
  let roomState = null;
  let reconnectTimer = null;
  let leaving = false;

  function readSession() {
    try {
      const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
      if (!value || !value.code || !value.token || !value.name || !value.gameType) return null;
      return value;
    } catch {
      return null;
    }
  }

  function hasSession() {
    return Boolean(session);
  }

  function saveSession(value) {
    session = value;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  }

  function leave() {
    leaving = true;
    window.clearTimeout(reconnectTimer);
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "left room");
    sessionStorage.removeItem(STORAGE_KEY);
    window.location.replace("./index.html");
  }

  function goToGame(gameType) {
    const target = GAME_PATHS[gameType] || GAME_PATHS.pick;
    const onDicePage = window.location.pathname.endsWith("dice.html") || window.location.pathname.endsWith("/dice");
    if (gameType === "dice" && !onDicePage) window.location.replace(target);
    else if (gameType !== "dice" && onDicePage) window.location.replace(target);
    else if (gameType !== "dice" && window.location.hash !== `#${gameType}`) window.location.hash = gameType;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[character]);
  }

  function renderLobby() {
    document.body.dataset.lobby = "true";
    const header = document.querySelector(".site-header");
    if (header) header.hidden = true;
    const app = document.querySelector("#app");
    if (!app) return;
    app.innerHTML = `
      <main class="room-lobby">
        <section class="lobby-intro" aria-labelledby="lobby-title">
          <img src="./assets/logo.svg" alt="하면해" class="lobby-logo" />
          <p class="lobby-eyebrow">우리끼리 바로 시작하는 내기 게임</p>
          <h1 id="lobby-title">오늘은 어떤 방에서<br />놀아볼까요?</h1>
          <p class="lobby-copy">이름은 이 브라우저를 나가면 사라져요.<br />부담 없이 방을 만들거나 친구 방에 입장해보세요.</p>
        </section>
        <section class="lobby-card" aria-label="방 시작하기">
          <div class="lobby-tabs" role="tablist" aria-label="방 시작 방식">
            <button class="lobby-tab is-active" type="button" role="tab" aria-selected="true" data-lobby-tab="create">방 만들기</button>
            <button class="lobby-tab" type="button" role="tab" aria-selected="false" data-lobby-tab="join">방 입장하기</button>
          </div>
          <form class="room-form" data-room-form="create">
            <label><span>내 이름 <small>방장</small></span><input name="hostName" maxlength="12" autocomplete="off" placeholder="이름을 입력해주세요" required /></label>
            <label><span>방 이름</span><input name="roomName" maxlength="24" autocomplete="off" placeholder="예: 오늘 저녁은 누가 쏠까?" required /></label>
            <fieldset class="privacy-fieldset">
              <legend>방 공개 설정</legend>
              <div class="segmented-control">
                <label><input type="radio" name="privacy" value="public" checked /><span>공개</span></label>
                <label><input type="radio" name="privacy" value="private" /><span>비공개</span></label>
              </div>
            </fieldset>
            <label class="password-field" data-create-password hidden><span>비밀번호</span><input name="password" type="password" minlength="4" maxlength="64" autocomplete="new-password" placeholder="4자 이상 입력해주세요" /></label>
            <fieldset class="game-fieldset">
              <legend>게임 종류</legend>
              <div class="game-choice-grid">
                <label class="game-choice game-choice--dice"><input type="radio" name="gameType" value="dice" checked /><span><b>0의 주사위</b><small>가장 낮은 사람이 쏘기</small></span></label>
                <label class="game-choice game-choice--pick"><input type="radio" name="gameType" value="pick" /><span><b>아무나 걸려라</b><small>아묻따 랜덤 뽑기</small></span></label>
                <label class="game-choice game-choice--team"><input type="radio" name="gameType" value="team" /><span><b>팀 나누기</b><small>공평하게 팀 만들기</small></span></label>
              </div>
            </fieldset>
            <p class="form-error" role="alert" data-form-error></p>
            <button class="lobby-submit" type="submit">방 만들고 시작하기</button>
          </form>
          <form class="room-form" data-room-form="join" hidden>
            <label><span>내 이름 <small>손님</small></span><input name="name" maxlength="12" autocomplete="off" placeholder="들어갈 때 사용할 이름" required /></label>
            <label><span>방 코드</span><input class="room-code-input" name="code" maxlength="8" autocomplete="off" autocapitalize="characters" placeholder="8자리 방 코드" required /></label>
            <label><span>비밀번호 <small>비공개 방만</small></span><input name="password" type="password" maxlength="64" autocomplete="current-password" placeholder="공개 방이라면 비워두세요" /></label>
            <p class="form-hint">방장에게 받은 방 코드를 입력해주세요.</p>
            <p class="form-error" role="alert" data-form-error></p>
            <button class="lobby-submit" type="submit">방에 입장하기</button>
          </form>
        </section>
      </main>`;

    app.querySelectorAll("[data-lobby-tab]").forEach((button) => {
      button.addEventListener("click", () => switchLobbyTab(button.dataset.lobbyTab));
    });
    app.querySelectorAll('input[name="privacy"]').forEach((input) => input.addEventListener("change", updatePrivacyField));
    app.querySelector('[data-room-form="create"]').addEventListener("submit", createRoom);
    app.querySelector('[data-room-form="join"]').addEventListener("submit", joinRoom);
    app.querySelector(".room-code-input").addEventListener("input", (event) => {
      event.currentTarget.value = event.currentTarget.value.toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, "");
    });
  }

  function switchLobbyTab(tab) {
    document.querySelectorAll("[data-lobby-tab]").forEach((button) => {
      const active = button.dataset.lobbyTab === tab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll("[data-room-form]").forEach((form) => { form.hidden = form.dataset.roomForm !== tab; });
    document.querySelector(`[data-room-form="${tab}"] input`)?.focus();
  }

  function updatePrivacyField() {
    const isPrivate = document.querySelector('input[name="privacy"]:checked')?.value === "private";
    const field = document.querySelector("[data-create-password]");
    const input = field?.querySelector("input");
    if (!field || !input) return;
    field.hidden = !isPrivate;
    input.required = isPrivate;
    if (!isPrivate) input.value = "";
  }

  async function api(path, options) {
    const response = await fetch(path, {
      ...options,
      headers: { "content-type": "application/json", ...(options?.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "잠시 후 다시 시도해주세요.");
    return data;
  }

  async function submitForm(form, request) {
    const button = form.querySelector("button[type='submit']");
    const error = form.querySelector("[data-form-error]");
    error.textContent = "";
    button.disabled = true;
    button.dataset.originalText = button.textContent;
    button.textContent = "연결하는 중…";
    try {
      const data = await request();
      saveSession({
        code: data.code,
        token: data.token,
        name: form.elements.hostName?.value.trim() || form.elements.name?.value.trim(),
        gameType: data.room.gameType,
        role: form.dataset.roomForm === "create" ? "host" : "guest",
      });
      goToGame(data.room.gameType);
      if (window.location.pathname.endsWith("index.html") || window.location.pathname.endsWith("/")) window.location.reload();
    } catch (caught) {
      error.textContent = caught instanceof Error ? caught.message : "잠시 후 다시 시도해주세요.";
      button.disabled = false;
      button.textContent = button.dataset.originalText;
    }
  }

  async function createRoom(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const isPrivate = values.get("privacy") === "private";
    await submitForm(form, () => api("/api/rooms", {
      method: "POST",
      body: JSON.stringify({
        hostName: values.get("hostName"),
        roomName: values.get("roomName"),
        gameType: values.get("gameType"),
        isPrivate,
        password: isPrivate ? values.get("password") : "",
      }),
    }));
  }

  async function joinRoom(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const code = String(values.get("code") || "").toUpperCase();
    await submitForm(form, () => api(`/api/rooms/${encodeURIComponent(code)}/join`, {
      method: "POST",
      body: JSON.stringify({ name: values.get("name"), password: values.get("password") }),
    }));
  }

  function mountRoomChrome() {
    if (document.querySelector(".room-bar")) return;
    document.body.classList.add("room-active");
    document.body.insertAdjacentHTML("afterbegin", `
      <header class="room-bar">
        <div class="room-identity">
          <span class="connection-dot" data-connection-dot></span>
          <div><strong data-room-name>방 연결 중…</strong><span><b data-host-name>방장 확인 중</b> · 코드 <button type="button" data-copy-code>${escapeHtml(session.code)}</button></span></div>
        </div>
        <div class="room-members" aria-label="참여 중인 사람">
          <div class="avatar-stack" data-avatar-stack></div>
          <strong data-member-count>1명</strong>
        </div>
        <button class="chat-mobile-toggle" type="button" aria-label="채팅 열기" data-chat-toggle>💬</button>
        <button class="room-leave" type="button" data-room-leave>나가기</button>
      </header>
      <aside class="chat-panel" aria-label="방 채팅">
        <header><div><strong>채팅</strong><span data-chat-status>연결 중…</span></div><button type="button" class="chat-close" aria-label="채팅 닫기" data-chat-close>×</button></header>
        <div class="chat-messages" data-chat-messages aria-live="polite"><p class="chat-empty">방에 연결되면 대화를 시작할 수 있어요.</p></div>
        <div class="emoji-picker" data-emoji-picker hidden>
          <div class="emoji-picker__head"><strong>하면해 이모티콘</strong><button type="button" aria-label="이모티콘 닫기" data-emoji-close>×</button></div>
          <div class="emoji-grid">${EMOJIS.map(([key, label]) => `<button type="button" title="${label}" aria-label="${label}" data-emoji-key="${key}"><img src="./assets/emojis/${key}.png" alt="" /></button>`).join("")}</div>
        </div>
        <form class="chat-compose" data-chat-form>
          <button class="emoji-button" type="button" aria-label="이모티콘" title="하면해 이모티콘 열기" data-emoji>☺</button>
          <input maxlength="500" autocomplete="off" placeholder="메시지를 입력하세요" aria-label="채팅 메시지" data-chat-input />
          <button class="chat-send" type="submit" aria-label="메시지 보내기">↑</button>
        </form>
      </aside>`);
    document.querySelector("[data-room-leave]").addEventListener("click", leave);
    document.querySelector("[data-copy-code]").addEventListener("click", copyRoomCode);
    document.querySelector("[data-chat-toggle]").addEventListener("click", () => document.body.classList.add("chat-open"));
    document.querySelector("[data-chat-close]").addEventListener("click", () => document.body.classList.remove("chat-open"));
    document.querySelector("[data-emoji]").addEventListener("click", toggleEmojiPicker);
    document.querySelector("[data-emoji-close]").addEventListener("click", () => setEmojiPicker(false));
    document.querySelectorAll("[data-emoji-key]").forEach((button) => button.addEventListener("click", () => sendEmoji(button.dataset.emojiKey)));
    document.querySelector("[data-chat-form]").addEventListener("submit", sendChat);
  }

  async function copyRoomCode(event) {
    try {
      await navigator.clipboard.writeText(session.code);
      const button = event.currentTarget;
      const original = button.textContent;
      button.textContent = "복사됨!";
      window.setTimeout(() => { button.textContent = original; }, 1200);
    } catch {
      showChatNotice(`방 코드: ${session.code}`);
    }
  }

  function connect() {
    mountRoomChrome();
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(`${scheme}://${window.location.host}/api/rooms/${encodeURIComponent(session.code)}/websocket`, [`betya.${session.token}`]);
    setConnectionStatus("connecting");
    socket.addEventListener("open", () => setConnectionStatus("connected"));
    socket.addEventListener("message", handleSocketMessage);
    socket.addEventListener("close", (event) => {
      setConnectionStatus("disconnected");
      if (!leaving && event.code !== 1000) reconnectTimer = window.setTimeout(connect, 1800);
    });
    socket.addEventListener("error", () => setConnectionStatus("disconnected"));
  }

  function handleSocketMessage(event) {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    if (data.type === "ready") {
      roomState = { ...(roomState || {}), room: data.room };
      updateRoomHeader();
      document.dispatchEvent(new CustomEvent("betya-room-ready", { detail: data.room }));
    }
    if (data.type === "presence") {
      roomState = data;
      updateRoomHeader();
    }
    if (data.type === "chat") appendChat(data);
    if (data.type === "emoji") appendEmoji(data);
  }

  function updateRoomHeader() {
    if (!roomState?.room) return;
    const members = roomState.members || [{ name: session.name, role: session.role }];
    const host = members.find((member) => member.role === "host");
    document.querySelector("[data-room-name]").textContent = roomState.room.roomName;
    document.querySelector("[data-host-name]").textContent = host ? `${host.name} 방장` : "방장 연결 대기";
    document.querySelector("[data-member-count]").textContent = `${members.length}명`;
    document.querySelector("[data-avatar-stack]").innerHTML = members.slice(0, 5).map((member, index) => `
      <span class="member-avatar${member.role === "host" ? " is-host" : ""}" style="--avatar-index:${index}" title="${escapeHtml(member.name)}">${escapeHtml(Array.from(member.name.trim())[0] || "?")}</span>`).join("") +
      (members.length > 5 ? `<span class="member-avatar is-more">+${members.length - 5}</span>` : "");
  }

  function setConnectionStatus(status) {
    const dot = document.querySelector("[data-connection-dot]");
    const label = document.querySelector("[data-chat-status]");
    if (dot) dot.dataset.status = status;
    if (label) label.textContent = status === "connected" ? "실시간 연결됨" : status === "connecting" ? "연결 중…" : "다시 연결 중…";
  }

  function sendChat(event) {
    event.preventDefault();
    const input = document.querySelector("[data-chat-input]");
    const text = input.value.trim();
    if (!text || socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "chat", text }));
    input.value = "";
    input.focus();
  }

  function setEmojiPicker(open) {
    const picker = document.querySelector("[data-emoji-picker]");
    if (picker) picker.hidden = !open;
  }

  function toggleEmojiPicker() {
    const picker = document.querySelector("[data-emoji-picker]");
    if (picker) setEmojiPicker(picker.hidden);
  }

  function sendEmoji(key) {
    if (!EMOJIS.some(([emojiKey]) => emojiKey === key) || socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "emoji", key }));
    setEmojiPicker(false);
  }

  function appendChat(message) {
    const list = document.querySelector("[data-chat-messages]");
    list.querySelector(".chat-empty")?.remove();
    const mine = message.name === session.name;
    const item = document.createElement("article");
    item.className = `chat-message${mine ? " is-mine" : ""}`;
    const author = document.createElement("span");
    author.textContent = message.role === "host" ? `${message.name} · 방장` : message.name;
    const bubble = document.createElement("p");
    bubble.textContent = message.text;
    item.append(author, bubble);
    list.append(item);
    while (list.children.length > 100) list.firstElementChild.remove();
    list.scrollTop = list.scrollHeight;
  }

  function appendEmoji(message) {
    const emoji = EMOJIS.find(([key]) => key === message.key);
    if (!emoji) return;
    const list = document.querySelector("[data-chat-messages]");
    list.querySelector(".chat-empty")?.remove();
    const mine = message.name === session.name;
    const item = document.createElement("article");
    item.className = `chat-message chat-message--emoji${mine ? " is-mine" : ""}`;
    const author = document.createElement("span");
    author.textContent = message.role === "host" ? `${message.name} · 방장` : message.name;
    const image = document.createElement("img");
    image.src = `./assets/emojis/${message.key}.png`;
    image.alt = emoji[1];
    item.append(author, image);
    list.append(item);
    while (list.children.length > 100) list.firstElementChild.remove();
    list.scrollTop = list.scrollHeight;
  }

  function showChatNotice(text) {
    const list = document.querySelector("[data-chat-messages]");
    if (!list) return;
    list.querySelector(".chat-empty")?.remove();
    const notice = document.createElement("p");
    notice.className = "chat-notice";
    notice.textContent = text;
    list.append(notice);
    list.scrollTop = list.scrollHeight;
  }

  window.BetyaRoom = { hasSession, leave, session: () => session };

  if (!session) {
    const onDicePage = window.location.pathname.endsWith("dice.html") || window.location.pathname.endsWith("/dice");
    if (onDicePage) window.location.replace("./index.html");
    else renderLobby();
    return;
  }

  goToGame(session.gameType);
  connect();
})();
