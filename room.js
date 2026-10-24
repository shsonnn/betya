// Drop-in replacement for the frontend's room.js that talks to the Python
// backend at https://betya-api.toxcap.com. The markup, CSS classes and
// window.BetyaRoom entry points of the original file are kept; the transport
// changes are:
//   - REST calls go to the API origin with credentials: "include"; the session
//     lives in an HttpOnly cookie, so no token is stored in sessionStorage.
//   - The WebSocket uses /api/rooms/{code}/ws and the {type, payload} envelope.
//   - Invitation links /room/{code} (or /?invite={code}) open the join form
//     with the code filled in; the password field only shows for private rooms.
(() => {
  const STORAGE_KEY = "betya.room.session";
  const API_BASE = resolveApiBase();
  const GAME_PATHS = {
    dice: "/dice.html",
    pick: "/index.html#pick",
    team: "/index.html#team",
  };
  // Frontend route keys <-> backend game_type values.
  const GAME_TYPE_TO_API = { dice: "dice", pick: "random_pick", team: "teams" };
  const API_TO_GAME_TYPE = { dice: "dice", random_pick: "pick", teams: "team" };
  const EMOJIS = [
    ["shotgun", "샷건"], ["not-me", "나만 아니면 돼"], ["winner", "이겨서 기분 좋음"],
    ["despair", "절망"], ["drool", "군침이 싹"], ["minus-100m", "-1억"],
    ["scream", "끼야호"], ["huh", "엥?"], ["oh", "오~"], ["close", "까비"],
  ];
  const ERROR_MESSAGES = {
    ROOM_NOT_FOUND: "방을 찾을 수 없어요. 코드를 확인하거나 방이 이미 닫혔는지 확인해주세요.",
    INVALID_PASSWORD: "비밀번호가 맞지 않아요.",
    INVALID_SESSION: "방 연결이 끝났어요. 다시 입장해주세요.",
    FORBIDDEN: "방장만 할 수 있어요.",
    INVALID_INPUT: "입력한 내용을 다시 확인해주세요.",
    ROOM_FULL: "방이 가득 찼어요.",
    NICKNAME_TAKEN: "이미 같은 이름을 쓰는 사람이 있어요.",
    RATE_LIMITED: "너무 빨라요! 잠시 후 다시 시도해주세요.",
    INVALID_STATE: "지금은 할 수 없는 동작이에요.",
    ORIGIN_NOT_ALLOWED: "허용되지 않은 주소에서 접속했어요.",
  };
  // Close codes after which reconnecting cannot succeed.
  const SESSION_ENDED_CLOSE_CODES = new Set([1000, 4000, 4002, 4003]);
  const CLOSE_CODE_REPLACED = 4001;
  const MAX_FAILED_CONNECTS_BEFORE_CHECK = 3;
  // "ping" is answered by the runtime with "pong" without waking the room, and
  // lets the server drop connections that silently died (mobile networks).
  const HEARTBEAT_INTERVAL_MS = 30000;

  let socket = null;
  let session = readSession();
  let roomState = null;
  let reconnectTimer = null;
  let leaving = false;
  let failedConnects = 0;
  let heartbeatTimer = null;

  function resolveApiBase() {
    const configured = document.querySelector('meta[name="betya-api-base"]')?.content;
    if (configured) return configured.replace(/\/$/, "");
    // Local development: frontend and API must use the same host name so the
    // SameSite=Strict session cookie is sent.
    if (["localhost", "127.0.0.1"].includes(window.location.hostname)) {
      return `${window.location.protocol}//${window.location.hostname}:8787`;
    }
    return "https://betya-api.toxcap.com";
  }

  function readSession() {
    try {
      const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
      if (!value || !value.code || !value.playerId || !value.name || !value.gameType) return null;
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

  function clearSession() {
    session = null;
    sessionStorage.removeItem(STORAGE_KEY);
  }

  function leave() {
    leaving = true;
    window.clearTimeout(reconnectTimer);
    if (session) {
      // keepalive lets the request finish while the page navigates away.
      fetch(`${API_BASE}/api/rooms/${encodeURIComponent(session.code)}/leave`, {
        method: "POST",
        credentials: "include",
        keepalive: true,
      }).catch(() => {});
    }
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "left room");
    clearSession();
    window.location.replace("/index.html");
  }

  function isDicePage() {
    return window.location.pathname.endsWith("dice.html") || window.location.pathname.endsWith("/dice");
  }

  function isIndexPage() {
    return window.location.pathname === "/" || window.location.pathname.endsWith("/index.html");
  }

  function goToGame(gameType) {
    if (gameType === "dice") {
      if (!isDicePage()) window.location.replace(GAME_PATHS.dice);
      return;
    }
    if (!isIndexPage()) window.location.replace(GAME_PATHS[gameType] || GAME_PATHS.pick);
    else if (window.location.hash !== `#${gameType}`) window.location.hash = gameType;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[character]);
  }

  function renderLanding() {
    document.body.dataset.route = "home";
    delete document.body.dataset.lobby;
    const header = document.querySelector(".site-header");
    if (header) header.hidden = false;
    const app = document.querySelector("#app");
    const template = document.querySelector("#home-template");
    if (!app || !template) return;
    app.replaceChildren(template.content.cloneNode(true));
    app.querySelectorAll(".game-card[data-route]").forEach((card) => {
      card.addEventListener("click", () => renderLobby(card.dataset.route));
    });
    app.querySelector(".home-join-button")?.addEventListener("click", () => renderLobby("dice", null, "join"));
  }

  function renderLobby(gameType = "dice", invite = null, mode = "create") {
    const app = document.querySelector("#app");
    if (!app) return;
    const gameNames = { dice: "0의 주사위", pick: "아무나 걸려라", team: "팀 나누기" };
    if (!Object.hasOwn(gameNames, gameType)) gameType = "dice";
    // Only one lobby dialog at a time (e.g. a card tapped while an invitation loads).
    app.querySelectorAll(".room-dialog").forEach((existing) => existing.remove());
    const dialog = document.createElement("dialog");
    dialog.className = "room-dialog";
    dialog.setAttribute("aria-labelledby", "room-dialog-title");
    dialog.dataset.game = gameType;
    dialog.dataset.mode = invite ? "join" : mode;
    dialog.innerHTML = `
      <div class="room-dialog-heading">
        <h2 id="room-dialog-title">${dialog.dataset.mode === "join" ? "방 입장하기" : gameNames[gameType]}</h2>
        <button class="room-dialog-close" type="button" aria-label="게임 선택으로 돌아가기">×</button>
      </div>
      <div class="room-lobby">
        <section class="lobby-card" aria-label="방 시작하기">
          <form class="room-form" data-room-form="create" ${dialog.dataset.mode === "join" ? "hidden" : ""}>
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
            <p class="form-error" role="alert" data-form-error></p>
            <button class="lobby-submit" type="submit">방 만들고 시작하기</button>
          </form>
          <form class="room-form" data-room-form="join" ${dialog.dataset.mode === "join" ? "" : "hidden"}>
            <label><span>내 이름 <small>손님</small></span><input name="name" maxlength="12" autocomplete="off" placeholder="들어갈 때 사용할 이름" required /></label>
            <label><span>방 코드</span><input class="room-code-input" name="code" maxlength="8" autocomplete="off" autocapitalize="characters" placeholder="8자리 방 코드" required /></label>
            <label data-join-password><span>비밀번호 <small>비공개 방만</small></span><input name="password" type="password" maxlength="64" autocomplete="current-password" placeholder="공개 방이라면 비워두세요" /></label>
            <p class="form-hint" data-join-hint>방장에게 받은 방 코드를 입력해주세요.</p>
            <p class="form-error" role="alert" data-form-error></p>
            <button class="lobby-submit" type="submit">방에 입장하기</button>
          </form>
        </section>
      </div>`;

    app.append(dialog);
    const entryButton = dialog.dataset.mode === "join"
      ? app.querySelector(".home-join-button")
      : app.querySelector(`[data-route="${gameType}"]`);
    dialog.addEventListener("close", () => {
      dialog.remove();
      entryButton?.focus({ preventScroll: true });
    }, { once: true });
    dialog.querySelector(".room-dialog-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    });
    dialog.showModal();
    dialog.querySelector(dialog.dataset.mode === "join" ? 'input[name="name"]' : 'input[name="hostName"]').focus({ preventScroll: true });
    app.querySelectorAll('input[name="privacy"]').forEach((input) => input.addEventListener("change", updatePrivacyField));
    app.querySelector('[data-room-form="create"]').addEventListener("submit", createRoom);
    app.querySelector('[data-room-form="join"]').addEventListener("submit", joinRoom);
    app.querySelector(".room-code-input").addEventListener("input", (event) => {
      event.currentTarget.value = event.currentTarget.value.toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, "");
    });

    if (invite) applyInvitation(dialog, invite);
  }

  function applyInvitation(dialog, invite) {
    const joinForm = dialog.querySelector('[data-room-form="join"]');
    const codeInput = joinForm.elements.code;
    codeInput.value = invite.code;
    codeInput.readOnly = true;
    // requiresPassword is true, false, or undefined when the room could not be checked.
    const passwordField = joinForm.querySelector("[data-join-password]");
    passwordField.hidden = invite.requiresPassword === false;
    joinForm.elements.password.required = invite.requiresPassword === true;
    const hint = joinForm.querySelector("[data-join-hint]");
    if (invite.roomName) hint.textContent = `초대받은 방: ${invite.roomName}`;
    else if (invite.requiresPassword) hint.textContent = "비공개 방이에요. 방장에게 받은 비밀번호를 입력해주세요.";
    else hint.textContent = "이름만 입력하면 바로 들어갈 수 있어요.";
    if (invite.error) joinForm.querySelector("[data-form-error]").textContent = invite.error;
    joinForm.elements.name.focus({ preventScroll: true });
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

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body) headers["content-type"] = "application/json";
    const response = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: "include" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = data.error?.code;
      const error = new Error(ERROR_MESSAGES[code] || data.error?.message || "잠시 후 다시 시도해주세요.");
      error.code = code;
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function sessionFromMembership(room, player) {
    return {
      code: room.code,
      playerId: player.player_id,
      name: player.nickname,
      gameType: API_TO_GAME_TYPE[room.game_type] || "pick",
      role: player.is_host ? "host" : "guest",
    };
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
      saveSession(sessionFromMembership(data.room, data.player));
      enterRoom();
    } catch (caught) {
      error.textContent = caught instanceof Error ? caught.message : "잠시 후 다시 시도해주세요.";
      button.disabled = false;
      button.textContent = button.dataset.originalText;
    }
  }

  function enterRoom() {
    goToGame(session.gameType);
    if (isIndexPage()) {
      if (window.location.search) window.history.replaceState(null, "", `/index.html${window.location.hash}`);
      window.location.reload();
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
        nickname: values.get("hostName"),
        room_name: values.get("roomName"),
        visibility: isPrivate ? "private" : "public",
        password: isPrivate ? values.get("password") : null,
        game_type: GAME_TYPE_TO_API[form.closest(".room-dialog").dataset.game],
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
      body: JSON.stringify({ nickname: values.get("name"), password: values.get("password") || null }),
    }));
  }

  function inviteCodeFromUrl() {
    const match = window.location.pathname.match(/^\/room\/([^/]+)\/?$/);
    const raw = match ? decodeURIComponent(match[1]) : new URLSearchParams(window.location.search).get("invite");
    if (!raw) return null;
    const code = raw.toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, "");
    return code.length === 8 ? code : null;
  }

  async function openInvitation(code) {
    renderLanding();
    try {
      const data = await api(`/api/rooms/${encodeURIComponent(code)}`);
      if (data.session) {
        // This browser already holds a session for the room: go straight in.
        saveSession(sessionFromMembership(data.room, data.session));
        enterRoom();
        return;
      }
      renderLobby(API_TO_GAME_TYPE[data.room.game_type] || "dice", {
        code,
        requiresPassword: data.room.requires_password,
        roomName: data.room.name,
      });
    } catch (caught) {
      renderLobby("dice", {
        code,
        requiresPassword: caught.status === 404 ? false : undefined,
        error: caught.status === 404 ? caught.message : "방 정보를 확인하지 못했어요. 비공개 방이라면 비밀번호도 입력해주세요.",
      });
    }
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
          <div class="emoji-grid">${EMOJIS.map(([key, label]) => `<button type="button" title="${label}" aria-label="${label}" data-emoji-key="${key}"><img src="/assets/emojis/${key}.png" alt="" /><span>${label}</span></button>`).join("")}</div>
        </div>
        <form class="chat-compose" data-chat-form>
          <button class="emoji-button" type="button" aria-label="이모티콘" title="하면해 이모티콘 열기" data-emoji>☺</button>
          <input maxlength="500" autocomplete="off" placeholder="메시지를 입력하세요" aria-label="채팅 메시지" data-chat-input />
          <button class="chat-send" type="submit" aria-label="메시지 보내기">↑</button>
        </form>
      </aside>`);
    document.querySelector("[data-room-leave]").addEventListener("click", leave);
    document.querySelector("[data-copy-code]").addEventListener("click", copyInviteLink);
    document.querySelector("[data-chat-toggle]").addEventListener("click", () => document.body.classList.add("chat-open"));
    document.querySelector("[data-chat-close]").addEventListener("click", () => document.body.classList.remove("chat-open"));
    document.querySelector("[data-emoji]").addEventListener("click", toggleEmojiPicker);
    document.querySelector("[data-emoji-close]").addEventListener("click", () => setEmojiPicker(false));
    document.querySelectorAll("[data-emoji-key]").forEach((button) => button.addEventListener("click", () => sendEmoji(button.dataset.emojiKey)));
    document.querySelector("[data-chat-form]").addEventListener("submit", sendChat);
  }

  async function copyInviteLink(event) {
    // currentTarget is null once the click dispatch is over, so read it first.
    const button = event.currentTarget;
    const inviteUrl = roomState?.room?.invite_url || `${window.location.origin}/room/${session.code}`;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      button.textContent = "초대 링크 복사됨!";
      window.setTimeout(() => { button.textContent = session?.code ?? button.textContent; }, 1200);
    } catch {
      showChatNotice(`초대 링크: ${inviteUrl}`);
    }
  }

  function connect() {
    mountRoomChrome();
    const wsBase = API_BASE.replace(/^http/, "ws");
    socket = new WebSocket(`${wsBase}/api/rooms/${encodeURIComponent(session.code)}/ws`);
    let opened = false;
    setConnectionStatus("connecting");
    socket.addEventListener("open", () => {
      opened = true;
      failedConnects = 0;
      setConnectionStatus("connected");
      window.clearInterval(heartbeatTimer);
      heartbeatTimer = window.setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) socket.send("ping");
      }, HEARTBEAT_INTERVAL_MS);
    });
    socket.addEventListener("message", handleSocketMessage);
    socket.addEventListener("close", (event) => {
      window.clearInterval(heartbeatTimer);
      setConnectionStatus("disconnected");
      if (leaving) return;
      if (SESSION_ENDED_CLOSE_CODES.has(event.code)) return endSession(event.reason);
      if (event.code === CLOSE_CODE_REPLACED) {
        // Another tab of this browser took over the seat. Take it back only
        // when the user returns to this tab, so two visible tabs do not fight.
        setConnectionStatus("replaced");
        showChatNotice("다른 탭에서 이 방에 연결했어요. 이 탭으로 돌아오면 다시 연결할게요.");
        resumeWhenVisible();
        return;
      }
      if (!opened) failedConnects += 1;
      if (failedConnects >= MAX_FAILED_CONNECTS_BEFORE_CHECK) {
        // A rejected handshake looks like a network error in the browser;
        // ask the API whether the session still exists.
        verifySession();
        return;
      }
      reconnectTimer = window.setTimeout(connect, 1800);
    });
    socket.addEventListener("error", () => setConnectionStatus("disconnected"));
  }

  function resumeWhenVisible() {
    const resume = () => {
      if (document.visibilityState !== "visible" || leaving) return;
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
      connect();
    };
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
  }

  async function verifySession() {
    try {
      const data = await api(`/api/rooms/${encodeURIComponent(session.code)}`);
      if (!data.session) return endSession();
      failedConnects = 0;
      reconnectTimer = window.setTimeout(connect, 1800);
    } catch (caught) {
      if (caught.status === 404) return endSession();
      reconnectTimer = window.setTimeout(verifySession, 5000);
    }
  }

  function endSession(reason) {
    window.clearTimeout(reconnectTimer);
    showChatNotice(reason === "room closed" ? "방이 닫혔어요." : "방 연결이 끝났어요. 처음 화면으로 돌아갈게요.");
    clearSession();
    window.setTimeout(() => window.location.replace("/index.html"), 1600);
  }

  function handleSocketMessage(event) {
    if (event.data === "pong") return;
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    const payload = data.payload || {};
    switch (data.type) {
      case "room.snapshot": {
        roomState = payload;
        // The cookie decides who we are; trust the server over sessionStorage.
        const me = payload.players.find((player) => player.player_id === payload.you?.player_id);
        if (me && session) saveSession({ ...session, playerId: me.player_id, name: me.nickname, role: me.is_host ? "host" : "guest" });
        updateRoomHeader();
        document.dispatchEvent(new CustomEvent("betya-room-ready", { detail: payload.room }));
        break;
      }
      case "player.joined":
      case "player.updated":
        upsertPlayer(payload.player);
        if (data.type === "player.joined") showChatNotice(`${payload.player.nickname}님이 들어왔어요.`);
        break;
      case "player.left":
        if (roomState) roomState.players = roomState.players.filter((player) => player.player_id !== payload.player_id);
        updateRoomHeader();
        showChatNotice(`${payload.nickname}님이 나갔어요.`);
        break;
      case "host.changed":
        if (roomState) {
          roomState.room.host_player_id = payload.host_player_id;
          roomState.players.forEach((player) => { player.is_host = player.player_id === payload.host_player_id; });
        }
        if (session && payload.host_player_id === session.playerId) saveSession({ ...session, role: "host" });
        updateRoomHeader();
        showChatNotice(`${payload.nickname}님이 새 방장이에요.`);
        break;
      case "chat.message":
        appendChat(payload);
        break;
      case "emoji.message":
        appendEmoji(payload);
        break;
      case "room.closed":
        endSession("room closed");
        break;
      case "error":
        showChatNotice(ERROR_MESSAGES[payload.code] || payload.message || "문제가 생겼어요.");
        break;
      default:
        if (data.type?.startsWith("game.")) {
          if (roomState && payload.game) roomState.game = payload.game;
          document.dispatchEvent(new CustomEvent("betya-game", { detail: data }));
        }
    }
  }

  function upsertPlayer(player) {
    if (!roomState || !player) return;
    const index = roomState.players.findIndex((existing) => existing.player_id === player.player_id);
    if (index === -1) roomState.players.push(player);
    else roomState.players[index] = player;
    roomState.players.sort((a, b) => a.join_order - b.join_order);
    updateRoomHeader();
  }

  function updateRoomHeader() {
    if (!roomState?.room) return;
    const members = roomState.players;
    const host = members.find((member) => member.is_host);
    document.querySelector("[data-room-name]").textContent = roomState.room.name || "비공개 방";
    document.querySelector("[data-host-name]").textContent = host ? `${host.nickname} 방장` : "방장 연결 대기";
    document.querySelector("[data-member-count]").textContent = `${members.length}명`;
    document.querySelector("[data-avatar-stack]").innerHTML = members.slice(0, 5).map((member, index) => `
      <span class="member-avatar${member.is_host ? " is-host" : ""}" style="--avatar-index:${index}" title="${escapeHtml(member.nickname)}">${escapeHtml(Array.from(member.nickname.trim())[0] || "?")}</span>`).join("") +
      (members.length > 5 ? `<span class="member-avatar is-more">+${members.length - 5}</span>` : "");
  }

  function setConnectionStatus(status) {
    const dot = document.querySelector("[data-connection-dot]");
    const label = document.querySelector("[data-chat-status]");
    if (dot) dot.dataset.status = status;
    const labels = { connected: "실시간 연결됨", connecting: "연결 중…", replaced: "다른 탭에서 사용 중" };
    if (label) label.textContent = labels[status] || "다시 연결 중…";
  }

  function send(type, payload = {}) {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type, payload }));
    return true;
  }

  function sendChat(event) {
    event.preventDefault();
    const input = document.querySelector("[data-chat-input]");
    const text = input.value.trim();
    if (!text || !send("chat.send", { text })) return;
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
    if (!EMOJIS.some(([emojiKey]) => emojiKey === key)) return;
    if (send("emoji.send", { emoji_id: key })) setEmojiPicker(false);
  }

  function isHostPlayer(playerId) {
    return roomState?.room?.host_player_id === playerId;
  }

  function messageMinute(message) {
    const raw = message.sent_at ?? message.created_at ?? message.timestamp ?? message.createdAt;
    let time = typeof raw === "number" ? raw : /^\d+$/.test(String(raw)) ? Number(raw) : Date.parse(raw);
    if (!Number.isFinite(time)) time = Date.now();
    if (time < 1e11) time *= 1000;
    return Math.floor(time / 60000);
  }

  function appendMessage(message, content) {
    const list = document.querySelector("[data-chat-messages]");
    list.querySelector(".chat-empty")?.remove();
    const minute = String(messageMinute(message));
    const previous = list.lastElementChild;
    let group = previous?.classList.contains("chat-message")
      && previous.dataset.playerId === String(message.player_id)
      && previous.dataset.minute === minute ? previous : null;
    const mine = message.player_id === session.playerId;
    if (!group) {
      group = document.createElement("article");
      group.className = `chat-message${mine ? " is-mine" : ""}`;
      group.dataset.playerId = message.player_id;
      group.dataset.minute = minute;
      const author = document.createElement("span");
      author.textContent = isHostPlayer(message.player_id) ? `${message.nickname} · 방장` : message.nickname;
      group.append(author);
      list.append(group);
    }
    if (content.tagName === "IMG") group.classList.add("chat-message--emoji");
    group.append(content);
    while (list.children.length > 100) list.firstElementChild.remove();
    list.scrollTop = list.scrollHeight;
  }

  function appendChat(message) {
    const bubble = document.createElement("p");
    bubble.textContent = message.text;
    appendMessage(message, bubble);
  }

  function appendEmoji(message) {
    const emoji = EMOJIS.find(([key]) => key === message.emoji_id);
    if (!emoji) return;
    const image = document.createElement("img");
    image.src = `/assets/emojis/${message.emoji_id}.png`;
    image.alt = emoji[1];
    appendMessage(message, image);
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

  // Game pages can call BetyaRoom.send("game.roll") etc. and listen for the
  // "betya-game" DOM event, whose detail is the server event envelope.
  window.BetyaRoom = { hasSession, leave, session: () => session, state: () => roomState, send };

  const inviteCode = inviteCodeFromUrl();
  if (inviteCode) {
    // The metadata call tells us whether the cookie still holds a session.
    clearSession();
    if (isDicePage()) window.location.replace(`/?invite=${inviteCode}`);
    else openInvitation(inviteCode);
    return;
  }

  if (!session) {
    if (isDicePage()) window.location.replace("/index.html");
    else renderLanding();
    return;
  }

  goToGame(session.gameType);
  connect();
})();
