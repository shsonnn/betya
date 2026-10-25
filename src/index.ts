import { DurableObject } from "cloudflare:workers";

type GameType = "dice" | "random_pick" | "teams";
type PlayerStatus = "pending" | "connected" | "disconnected";

interface Player {
  player_id: string;
  nickname: string;
  token_hash: string;
  join_order: number;
  is_host: boolean;
  status: PlayerStatus;
  reconnect_deadline_ms: number | null;
}

interface DiceRoll {
  index: number;
  first: number;
  second: number;
  sum: number;
  lastDigit: number;
}

interface GameState {
  type: GameType;
  revision: number;
  status: "idle" | "in_progress" | "complete";
  player_count?: number;
  names?: string[];
  rolls?: Array<DiceRoll | null>;
  current_index?: number;
  last_roll?: DiceRoll | null;
  result?: { lowest: number; losers: number[] } | null;
  items?: string[];
  pick_count?: number;
  winners?: string[];
  people?: string[];
  team_count?: number;
  pairs?: [string, string][];
  teams?: string[][];
  animation_until_ms?: number;
}

interface RoomState {
  code: string;
  name: string;
  visibility: "public" | "private";
  password_hash: string;
  game_type: GameType;
  created_at_ms: number;
  expires_at_ms: number;
  players: Player[];
  game: GameState;
}

interface SocketAttachment {
  player_id: string;
}

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const ROOM_TTL_MS = 8 * 60 * 60 * 1000;
const CONNECT_MS = 60 * 1000;
const RECONNECT_MS = 2 * 60 * 1000;
const ROLL_MS = 1800;
const REVEAL_MS = 2800;
const MAX_PLAYERS = 12;
const EMOJI_KEYS = new Set(["shotgun", "not-me", "winner", "despair", "drool", "minus-100m", "scream", "huh", "oh", "close"]);

function apiJson(body: unknown, status = 200, cookie?: string): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  if (cookie) headers.set("set-cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function apiError(code: string, message: string, status = 400): Response {
  return apiJson({ error: { code, message } }, status);
}

function normalize(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function randomInt(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max;
  const value = new Uint32Array(1);
  do crypto.getRandomValues(value); while (value[0] >= limit);
  return value[0] % max;
}

function randomString(length: number, alphabet: string): string {
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join("");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sameHash(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function gameFor(type: GameType): GameState {
  if (type === "dice") return {
    type, revision: 0, status: "idle", player_count: 6,
    names: Array(6).fill(""), rolls: Array(6).fill(null),
    current_index: 0, last_roll: null, result: null,
  };
  if (type === "random_pick") return {
    type, revision: 0, status: "idle", items: [], pick_count: 1, winners: [],
  };
  return {
    type, revision: 0, status: "idle", people: [], team_count: 2, pairs: [], teams: [],
  };
}

function shuffle<T>(values: T[]): T[] {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const target = randomInt(index + 1);
    [values[index], values[target]] = [values[target], values[index]];
  }
  return values;
}

function conflictCount(teams: string[][], pairs: [string, string][]): number {
  return teams.reduce((total, team) => total + pairs.filter(([a, b]) => team.includes(a) && team.includes(b)).length, 0);
}

function makeTeams(people: string[], count: number, pairs: [string, string][]): string[][] {
  let best: string[][] = [];
  let bestScore = Infinity;
  for (let attempt = 0; attempt < 1200; attempt += 1) {
    const teams = Array.from({ length: count }, () => [] as string[]);
    shuffle([...people]).forEach((name, index) => teams[index % count].push(name));
    const score = conflictCount(teams, pairs);
    if (score < bestScore) {
      best = teams;
      bestScore = score;
      if (score === 0) break;
    }
  }
  return best;
}

function publicPlayer(player: Player): Omit<Player, "token_hash"> {
  const { token_hash: _secret, ...publicValue } = player;
  return publicValue;
}

function publicRoom(state: RoomState, origin: string) {
  return {
    code: state.code, name: state.name, visibility: state.visibility,
    requires_password: state.visibility === "private", game_type: state.game_type,
    player_count: state.players.length, max_players: MAX_PLAYERS,
    is_full: state.players.length >= MAX_PLAYERS, created_at_ms: state.created_at_ms,
    invite_url: `${origin}/room/${state.code}`,
    host_player_id: state.players.find((player) => player.is_host)?.player_id ?? null,
  };
}

function cookieName(code: string, secure: boolean): string {
  return `${secure ? "__Host-" : ""}betya_${code}`;
}

function tokenFromCookie(request: Request, code: string): string {
  const name = cookieName(code, new URL(request.url).protocol === "https:");
  const match = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match?.slice(name.length + 1) ?? "";
}

function sessionCookie(request: Request, code: string, token: string, maxAge = 86400): string {
  const secure = new URL(request.url).protocol === "https:";
  return `${cookieName(code, secure)}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") || 0) > 8192) throw new Error("요청이 너무 큽니다.");
  const body: unknown = await request.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("요청 형식이 올바르지 않아요.");
  return body as Record<string, unknown>;
}

export class GameRoom extends DurableObject<Env> {
  private async read(): Promise<RoomState | null> {
    const state = await this.ctx.storage.get<RoomState>("state");
    return state && state.expires_at_ms > Date.now() ? state : null;
  }

  private async write(state: RoomState): Promise<void> {
    await this.ctx.storage.put("state", state);
  }

  private async scheduleAlarm(state: RoomState): Promise<void> {
    const deadlines = state.players.flatMap((player) => player.reconnect_deadline_ms ? [player.reconnect_deadline_ms] : []);
    await this.ctx.storage.setAlarm(Math.min(state.expires_at_ms, ...deadlines));
  }

  private async player(state: RoomState, token: string): Promise<Player | null> {
    if (!token) return null;
    const hash = await sha256(token);
    return state.players.find((candidate) => sameHash(candidate.token_hash, hash)) ?? null;
  }

  async create(input: { code: string; name: string; nickname: string; visibility: "public" | "private"; password: string; game_type: GameType; origin: string }) {
    if (await this.read()) return null;
    const token = randomToken();
    const now = Date.now();
    const player: Player = {
      player_id: `p_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
      nickname: input.nickname, token_hash: await sha256(token), join_order: 1,
      is_host: true, status: "pending", reconnect_deadline_ms: now + CONNECT_MS,
    };
    const state: RoomState = {
      code: input.code, name: input.name, visibility: input.visibility,
      password_hash: input.visibility === "private" ? await sha256(input.password) : "",
      game_type: input.game_type, created_at_ms: now, expires_at_ms: now + ROOM_TTL_MS,
      players: [player], game: gameFor(input.game_type),
    };
    await this.write(state);
    await this.scheduleAlarm(state);
    return { token, room: publicRoom(state, input.origin), player: publicPlayer(player) };
  }

  async inspect(token: string, origin: string) {
    const state = await this.read();
    if (!state) return null;
    const player = await this.player(state, token);
    return { room: publicRoom(state, origin), session: player ? publicPlayer(player) : null };
  }

  async join(nickname: string, password: string, origin: string) {
    const state = await this.read();
    if (!state) return { error: "ROOM_NOT_FOUND" };
    if (state.players.length >= MAX_PLAYERS) return { error: "ROOM_FULL" };
    if (state.players.some((player) => player.nickname === nickname)) return { error: "NICKNAME_TAKEN" };
    if (state.visibility === "private" && !sameHash(await sha256(password), state.password_hash)) return { error: "INVALID_PASSWORD" };
    const token = randomToken();
    const player: Player = {
      player_id: `p_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
      nickname, token_hash: await sha256(token), join_order: state.players.length + 1,
      is_host: false, status: "pending", reconnect_deadline_ms: Date.now() + CONNECT_MS,
    };
    state.players.push(player);
    await this.write(state);
    await this.scheduleAlarm(state);
    this.broadcast("player.joined", { player: publicPlayer(player) });
    return { token, room: publicRoom(state, origin), player: publicPlayer(player) };
  }

  async leave(token: string): Promise<boolean> {
    const state = await this.read();
    if (!state) return false;
    const player = await this.player(state, token);
    if (!player) return false;
    state.players = state.players.filter((candidate) => candidate.player_id !== player.player_id);
    for (const socket of this.ctx.getWebSockets()) {
      if ((socket.deserializeAttachment() as SocketAttachment | null)?.player_id === player.player_id) socket.close(1000, "left room");
    }
    this.broadcast("player.left", { player_id: player.player_id, nickname: player.nickname });
    if (!state.players.length) {
      await this.ctx.storage.deleteAll();
      return true;
    }
    if (player.is_host) {
      const next = state.players.slice().sort((a, b) => a.join_order - b.join_order)[0];
      next.is_host = true;
      this.broadcast("host.changed", { host_player_id: next.player_id, nickname: next.nickname });
    }
    await this.write(state);
    await this.scheduleAlarm(state);
    return true;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return apiError("INVALID_INPUT", "WebSocket 연결이 필요합니다.", 426);
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return apiError("ORIGIN_NOT_ALLOWED", "허용되지 않은 주소입니다.", 403);
    const state = await this.read();
    if (!state) return apiError("ROOM_NOT_FOUND", "방을 찾을 수 없어요.", 404);
    const player = await this.player(state, tokenFromCookie(request, state.code));
    if (!player) return apiError("INVALID_SESSION", "다시 입장해주세요.", 401);
    for (const socket of this.ctx.getWebSockets()) {
      if ((socket.deserializeAttachment() as SocketAttachment | null)?.player_id === player.player_id) socket.close(4001, "replaced");
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ player_id: player.player_id } satisfies SocketAttachment);
    player.status = "connected";
    player.reconnect_deadline_ms = null;
    await this.write(state);
    await this.scheduleAlarm(state);
    server.send(JSON.stringify({
      type: "room.snapshot",
      payload: {
        room: publicRoom(state, new URL(request.url).origin),
        players: state.players.map(publicPlayer),
        you: { player_id: player.player_id },
        game: state.game,
        server_time_ms: Date.now(),
      },
    }));
    this.broadcast("player.updated", { player: publicPlayer(player) }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === "ping") { socket.send("pong"); return; }
    if (typeof message !== "string" || message.length > 8192) return this.sendError(socket, "INVALID_INPUT", "요청이 너무 큽니다.");
    let envelope: { type?: unknown; payload?: unknown };
    try { envelope = JSON.parse(message); } catch { return this.sendError(socket, "INVALID_INPUT", "잘못된 메시지입니다."); }
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return this.sendError(socket, "INVALID_INPUT", "잘못된 메시지입니다.");
    const state = await this.read();
    const playerId = (socket.deserializeAttachment() as SocketAttachment | null)?.player_id;
    const player = state?.players.find((candidate) => candidate.player_id === playerId);
    if (!state || !player) return this.sendError(socket, "INVALID_SESSION", "방 연결이 끝났어요.");
    const payload = envelope.payload && typeof envelope.payload === "object" && !Array.isArray(envelope.payload)
      ? envelope.payload as Record<string, unknown> : {};
    if (envelope.type === "chat.send") {
      const value = normalize(payload.text, 500);
      if (!value) return;
      this.broadcast("chat.message", { player_id: player.player_id, nickname: player.nickname, text: value, sent_at: Date.now() });
      return;
    }
    if (envelope.type === "emoji.send") {
      if (typeof payload.emoji_id !== "string" || !EMOJI_KEYS.has(payload.emoji_id)) return;
      this.broadcast("emoji.message", { player_id: player.player_id, nickname: player.nickname, emoji_id: payload.emoji_id, sent_at: Date.now() });
      return;
    }
    if (typeof envelope.type !== "string" || !envelope.type.startsWith("game.")) return;
    if (!player.is_host) return this.sendError(socket, "FORBIDDEN", "방장만 게임을 진행할 수 있어요.");
    const error = this.applyGame(state, envelope.type, payload);
    if (error) return this.sendError(socket, error[0], error[1]);
    await this.write(state);
    const events: Record<string, string> = {
      "game.configure": "game.updated", "game.roll": "game.rolled",
      "game.draw": "game.drawn", "game.divide": "game.divided",
      "game.reset": "game.updated",
    };
    this.broadcast(events[envelope.type], { game: state.game });
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const state = await this.read();
    const playerId = (socket.deserializeAttachment() as SocketAttachment | null)?.player_id;
    const player = state?.players.find((candidate) => candidate.player_id === playerId);
    if (!state || !player) return;
    // A replacement socket may already have connected for this player.
    if (this.ctx.getWebSockets().some((other) => other !== socket && (other.deserializeAttachment() as SocketAttachment | null)?.player_id === playerId)) return;
    player.status = "disconnected";
    player.reconnect_deadline_ms = Date.now() + RECONNECT_MS;
    await this.write(state);
    await this.scheduleAlarm(state);
    this.broadcast("player.updated", { player: publicPlayer(player) }, socket);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    socket.close(1011, "connection error");
  }

  async alarm(): Promise<void> {
    const state = await this.ctx.storage.get<RoomState>("state");
    if (!state) return;
    if (state.expires_at_ms <= Date.now()) {
      this.broadcast("room.closed", {});
      for (const socket of this.ctx.getWebSockets()) socket.close(4000, "room closed");
      await this.ctx.storage.deleteAll();
      return;
    }
    const expired = state.players.filter((player) => player.status !== "connected" && (player.reconnect_deadline_ms || Infinity) <= Date.now());
    if (expired.length) {
      state.players = state.players.filter((player) => !expired.includes(player));
      for (const player of expired) this.broadcast("player.left", { player_id: player.player_id, nickname: player.nickname });
      if (!state.players.length) {
        await this.ctx.storage.deleteAll();
        return;
      }
      if (!state.players.some((player) => player.is_host)) {
        const next = state.players.slice().sort((a, b) => a.join_order - b.join_order)[0];
        next.is_host = true;
        this.broadcast("host.changed", { host_player_id: next.player_id, nickname: next.nickname });
      }
      await this.write(state);
    }
    await this.scheduleAlarm(state);
  }

  private applyGame(state: RoomState, type: string, payload: Record<string, unknown>): [string, string] | null {
    const game = state.game;
    if (type === "game.configure") {
      if (game.animation_until_ms && game.animation_until_ms > Date.now()) return ["INVALID_STATE", "결과 발표가 끝난 뒤 변경해주세요."];
      if (game.type === "dice") {
        const count = Number(payload.player_count);
        if (!Number.isInteger(count) || count < 2 || count > MAX_PLAYERS || !Array.isArray(payload.names)) return ["INVALID_INPUT", "참가 인원을 확인해주세요."];
        const names = payload.names.slice(0, count).map((name) => normalize(name, 8));
        while (names.length < count) names.push("");
        game.player_count = count; game.names = names; game.rolls = Array(count).fill(null);
        game.current_index = 0; game.last_roll = null; game.result = null; game.status = "idle";
      } else if (game.type === "random_pick") {
        if (!Array.isArray(payload.items)) return ["INVALID_INPUT", "뽑을 항목을 확인해주세요."];
        const items = Array.from(new Set(payload.items.slice(0, 100).map((item) => normalize(item, 40)).filter(Boolean)));
        const count = Number(payload.pick_count);
        if (!Number.isInteger(count) || count < 1 || count > Math.max(1, items.length)) return ["INVALID_INPUT", "당첨 인원을 확인해주세요."];
        game.items = items; game.pick_count = count; game.winners = []; game.status = "idle";
      } else {
        if (!Array.isArray(payload.people) || !Array.isArray(payload.pairs)) return ["INVALID_INPUT", "참가자 설정을 확인해주세요."];
        const people = Array.from(new Set(payload.people.slice(0, 100).map((name) => normalize(name, 40)).filter(Boolean)));
        const count = Number(payload.team_count);
        if (!Number.isInteger(count) || count < 2 || count > Math.max(2, people.length)) return ["INVALID_INPUT", "팀 개수를 확인해주세요."];
        const pairs = payload.pairs.slice(0, 100).filter((pair): pair is unknown[] => Array.isArray(pair) && pair.length === 2)
          .map((pair) => [normalize(pair[0], 40), normalize(pair[1], 40)] as [string, string])
          .filter(([a, b]) => a !== b && people.includes(a) && people.includes(b));
        game.people = people; game.team_count = count; game.pairs = pairs; game.teams = []; game.status = "idle";
      }
      game.animation_until_ms = undefined;
    } else if (type === "game.reset") {
      if (game.type === "dice") {
        game.rolls = Array(game.player_count || 6).fill(null);
        game.current_index = 0; game.last_roll = null; game.result = null;
      } else if (game.type === "random_pick") game.winners = [];
      else game.teams = [];
      game.status = "idle"; game.animation_until_ms = undefined;
    } else if (type === "game.roll" && game.type === "dice") {
      if (game.status === "complete" || (game.animation_until_ms || 0) > Date.now()) return ["INVALID_STATE", "지금은 굴릴 수 없어요."];
      const rolls = game.rolls || [];
      const index = game.current_index || 0;
      if (index >= rolls.length || rolls[index]) return ["INVALID_STATE", "이미 굴린 차례예요."];
      const counts = new Map<number, number>();
      rolls.filter((roll): roll is DiceRoll => Boolean(roll)).forEach((roll) => counts.set(roll.lastDigit, (counts.get(roll.lastDigit) || 0) + 1));
      const candidates: DiceRoll[] = [];
      for (let first = 1; first <= 6; first += 1) for (let second = 1; second <= 6; second += 1) {
        const sum = first + second;
        const lastDigit = sum % 10;
        if (lastDigit === 0 && counts.has(0)) continue;
        candidates.push({ index, first, second, sum, lastDigit });
      }
      const unused = candidates.filter((roll) => !counts.has(roll.lastDigit));
      const pool = unused.length ? unused : candidates.filter((roll) => (counts.get(roll.lastDigit) || 0) === Math.min(...candidates.map((candidate) => counts.get(candidate.lastDigit) || 0)));
      const roll = pool[randomInt(pool.length)];
      rolls[index] = roll;
      game.rolls = rolls; game.last_roll = roll; game.current_index = index + 1;
      game.animation_until_ms = Date.now() + ROLL_MS;
      game.status = index + 1 === rolls.length ? "complete" : "in_progress";
      if (game.status === "complete") {
        const lowest = Math.min(...rolls.filter((item): item is DiceRoll => Boolean(item)).map((item) => item.lastDigit));
        game.result = { lowest, losers: rolls.flatMap((item, playerIndex) => item?.lastDigit === lowest ? [playerIndex] : []) };
      }
    } else if (type === "game.draw" && game.type === "random_pick") {
      if (!game.items?.length || (game.animation_until_ms || 0) > Date.now()) return ["INVALID_STATE", "뽑을 항목을 먼저 넣어주세요."];
      game.winners = shuffle([...game.items]).slice(0, game.pick_count || 1);
      game.status = "complete"; game.animation_until_ms = Date.now() + REVEAL_MS;
    } else if (type === "game.divide" && game.type === "teams") {
      if (!game.people || game.people.length < 2 || (game.animation_until_ms || 0) > Date.now()) return ["INVALID_STATE", "참가자를 먼저 넣어주세요."];
      game.teams = makeTeams(game.people, game.team_count || 2, game.pairs || []);
      game.status = "complete"; game.animation_until_ms = Date.now() + REVEAL_MS;
    } else return ["INVALID_INPUT", "지원하지 않는 게임 동작이에요."];
    game.revision += 1;
    return null;
  }

  private sendError(socket: WebSocket, code: string, message: string): void {
    socket.send(JSON.stringify({ type: "error", payload: { code, message } }));
  }

  private broadcast(type: string, payload: unknown, exclude?: WebSocket): void {
    const message = JSON.stringify({ type, payload });
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === exclude || socket.readyState !== WebSocket.OPEN) continue;
      try { socket.send(message); } catch { /* Closed sockets disappear from getWebSockets. */ }
    }
  }
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.split("/").filter(Boolean);
  if (request.method === "POST" && url.pathname === "/api/rooms") {
    const body = await parseBody(request);
    const name = normalize(body.room_name, 24);
    const nickname = normalize(body.nickname, 12);
    const visibility = body.visibility === "private" ? "private" : "public";
    const password = typeof body.password === "string" ? body.password.slice(0, 64) : "";
    const gameType = body.game_type;
    if (!name || !nickname || (gameType !== "dice" && gameType !== "random_pick" && gameType !== "teams")) return apiError("INVALID_INPUT", "방 설정을 확인해주세요.");
    if (visibility === "private" && password.length < 4) return apiError("INVALID_INPUT", "비밀번호는 4자 이상 입력해주세요.");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = randomString(8, CODE_ALPHABET);
      const result = await env.ROOMS.getByName(code).create({ code, name, nickname, visibility, password, game_type: gameType, origin: url.origin });
      if (result) return apiJson({ room: result.room, player: result.player }, 201, sessionCookie(request, code, result.token));
    }
    return apiError("INVALID_STATE", "방을 만들지 못했어요. 다시 시도해주세요.", 503);
  }

  const code = path[2]?.toUpperCase() || "";
  if (path[0] !== "api" || path[1] !== "rooms" || !/^[2-9A-HJ-NP-Z]{8}$/.test(code)) return apiError("ROOM_NOT_FOUND", "방을 찾을 수 없어요.", 404);
  const room = env.ROOMS.getByName(code);
  if (request.method === "GET" && path.length === 3) {
    const result = await room.inspect(tokenFromCookie(request, code), url.origin);
    return result ? apiJson(result) : apiError("ROOM_NOT_FOUND", "방을 찾을 수 없어요.", 404);
  }
  if (request.method === "POST" && path[3] === "join") {
    const body = await parseBody(request);
    const nickname = normalize(body.nickname, 12);
    const password = typeof body.password === "string" ? body.password : "";
    if (!nickname) return apiError("INVALID_INPUT", "이름을 입력해주세요.");
    const result = await room.join(nickname, password, url.origin);
    if ("error" in result) {
      const errorCode = result.error || "INVALID_INPUT";
      const descriptions: Record<string, string> = {
        ROOM_NOT_FOUND: "방을 찾을 수 없어요.", ROOM_FULL: "방이 가득 찼어요.",
        NICKNAME_TAKEN: "이미 같은 이름을 쓰는 사람이 있어요.", INVALID_PASSWORD: "비밀번호가 맞지 않아요.",
      };
      return apiError(errorCode, descriptions[errorCode] || "입력값을 확인해주세요.", errorCode === "ROOM_NOT_FOUND" ? 404 : errorCode === "INVALID_PASSWORD" ? 401 : 409);
    }
    return apiJson({ room: result.room, player: result.player }, 200, sessionCookie(request, code, result.token));
  }
  if (request.method === "POST" && path[3] === "leave") {
    await room.leave(tokenFromCookie(request, code));
    return apiJson({ ok: true }, 200, sessionCookie(request, code, "", 0));
  }
  if (request.method === "GET" && path[3] === "ws") return room.fetch(request);
  return apiError("NOT_FOUND", "지원하지 않는 요청이에요.", 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(request, env);
      const invite = url.pathname.match(/^\/room\/([2-9A-HJ-NP-Z]{8})\/?$/i);
      if (invite && (request.method === "GET" || request.method === "HEAD")) {
        return Response.redirect(new URL(`/?invite=${invite[1].toUpperCase()}`, url), 302);
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof Error && /요청/.test(error.message)) return apiError("INVALID_INPUT", "요청 형식이 올바르지 않아요.");
      console.error(JSON.stringify({ event: "worker_error", path: url.pathname, message: error instanceof Error ? error.message : String(error) }));
      return apiError("SERVER_ERROR", "잠시 후 다시 시도해주세요.", 500);
    }
  },
} satisfies ExportedHandler<Env>;
