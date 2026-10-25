import { DurableObject } from "cloudflare:workers";

// 방 만들기·입장 기능은 요청에 따라 일시 중단했습니다. 정식 재개 전까지 API를 노출하지 않습니다.
const ROOM_FEATURE_ENABLED = false;

type GameType = "dice" | "pick" | "team";
type MemberRole = "host" | "guest";

interface RoomConfig {
  roomName: string;
  gameType: GameType;
  isPrivate: boolean;
  passwordHash: string;
  sessionSecret: string;
  createdAt: number;
}

interface SessionPayload {
  name: string;
  role: MemberRole;
  exp: number;
}

interface ConnectionAttachment extends SessionPayload {
  joinedAt: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const MAX_NAME_LENGTH = 12;
const MAX_ROOM_NAME_LENGTH = 24;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const EMOJI_KEYS = new Set(["shotgun", "not-me", "winner", "despair", "drool", "minus-100m", "scream", "huh", "oh", "close"]);

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return Response.json(data, { ...init, headers });
}

function log(level: "info" | "error", message: string, data: Record<string, unknown> = {}): void {
  const payload = JSON.stringify({ level, message, timestamp: new Date().toISOString(), ...data });
  if (level === "error") console.error(payload);
  else console.log(payload);
}

function normalizeText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function isGameType(value: unknown): value is GameType {
  return value === "dice" || value === "pick" || value === "team";
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function randomToken(bytes = 32): string {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return bytesToBase64Url(data);
}

function randomRoomCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length]).join("");
}

async function sha256(value: string): Promise<string> {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    base64UrlToBytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

async function timingSafeMatch(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 8_192) throw new Error("요청이 너무 큽니다.");
  const value: unknown = await request.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("잘못된 요청입니다.");
  return value as Record<string, unknown>;
}

export class GameRoom extends DurableObject<Env> {
  async createRoom(input: {
    roomName: string;
    hostName: string;
    gameType: GameType;
    isPrivate: boolean;
    password: string;
  }): Promise<{ token: string; room: Omit<RoomConfig, "passwordHash" | "sessionSecret"> }> {
    const existing = await this.ctx.storage.get<RoomConfig>("room");
    if (existing) throw new Error("이미 사용 중인 방 코드입니다.");

    const config: RoomConfig = {
      roomName: input.roomName,
      gameType: input.gameType,
      isPrivate: input.isPrivate,
      passwordHash: input.isPrivate ? await sha256(input.password) : "",
      sessionSecret: randomToken(),
      createdAt: Date.now(),
    };
    await this.ctx.storage.put("room", config);
    await this.ctx.storage.setAlarm(config.createdAt + SESSION_TTL_MS);
    const token = await this.issueToken(config, input.hostName, "host");
    return { token, room: this.publicRoom(config) };
  }

  async joinRoom(name: string, password: string): Promise<{ token: string; room: Omit<RoomConfig, "passwordHash" | "sessionSecret"> }> {
    const config = await this.ctx.storage.get<RoomConfig>("room");
    if (!config) throw new Error("존재하지 않거나 종료된 방입니다.");
    if (config.isPrivate) {
      const providedHash = await sha256(password);
      if (!(await timingSafeMatch(providedHash, config.passwordHash))) throw new Error("비밀번호가 맞지 않아요.");
    }
    const token = await this.issueToken(config, name, "guest");
    return { token, room: this.publicRoom(config) };
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }

    const config = await this.ctx.storage.get<RoomConfig>("room");
    if (!config) return new Response("Room not found", { status: 404 });
    const protocol = request.headers
      .get("sec-websocket-protocol")
      ?.split(",")
      .map((item) => item.trim())
      .find((item) => item.startsWith("betya."));
    const token = protocol?.slice("betya.".length) ?? "";
    const payload = await this.verifyToken(config, token);
    if (!payload) return new Response("Unauthorized", { status: 401 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ ...payload, joinedAt: Date.now() } satisfies ConnectionAttachment);
    server.send(JSON.stringify({ type: "ready", room: this.publicRoom(config) }));
    this.broadcastPresence(config);
    return new Response(null, { status: 101, webSocket: client, headers: { "sec-websocket-protocol": protocol ?? "" } });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string" || message.length > 2_048) return;
    const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
    if (!attachment) return;

    let event: unknown;
    try {
      event = JSON.parse(message);
    } catch {
      return;
    }
    if (!event || typeof event !== "object" || Array.isArray(event)) return;
    const data = event as Record<string, unknown>;
    if (data.type === "emoji" && typeof data.key === "string" && EMOJI_KEYS.has(data.key)) {
      this.broadcast({ type: "emoji", name: attachment.name, role: attachment.role, key: data.key, sentAt: Date.now() }, socket);
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const config = await this.ctx.storage.get<RoomConfig>("room");
    if (!config) return;
    this.broadcastPresence(config, socket);
    if (this.ctx.getWebSockets().filter((activeSocket) => activeSocket !== socket).length === 0) {
      await this.ctx.storage.deleteAll();
      log("info", "room_closed", { roomName: config.roomName });
    }
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    socket.close(1011, "connection error");
  }

  async alarm(): Promise<void> {
    if (this.ctx.getWebSockets().length === 0) {
      await this.ctx.storage.deleteAll();
      return;
    }
    await this.ctx.storage.setAlarm(Date.now() + 60 * 60 * 1000);
  }

  private publicRoom(config: RoomConfig): Omit<RoomConfig, "passwordHash" | "sessionSecret"> {
    const { passwordHash: _passwordHash, sessionSecret: _sessionSecret, ...room } = config;
    return room;
  }

  private async issueToken(config: RoomConfig, name: string, role: MemberRole): Promise<string> {
    const payload: SessionPayload = { name, role, exp: Date.now() + SESSION_TTL_MS };
    const encoded = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
    return `${encoded}.${await hmac(encoded, config.sessionSecret)}`;
  }

  private async verifyToken(config: RoomConfig, token: string): Promise<SessionPayload | null> {
    const [encoded, signature] = token.split(".");
    if (!encoded || !signature) return null;
    const expected = await hmac(encoded, config.sessionSecret);
    if (!(await timingSafeMatch(signature, expected))) return null;
    try {
      const value = JSON.parse(decoder.decode(base64UrlToBytes(encoded))) as SessionPayload;
      if (!value || value.exp < Date.now() || !normalizeText(value.name, MAX_NAME_LENGTH)) return null;
      if (value.role !== "host" && value.role !== "guest") return null;
      return { name: normalizeText(value.name, MAX_NAME_LENGTH), role: value.role, exp: value.exp };
    } catch {
      return null;
    }
  }

  private members(excludedSocket?: WebSocket): ConnectionAttachment[] {
    return this.ctx.getWebSockets().flatMap((socket) => {
      if (socket === excludedSocket) return [];
      const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
      return attachment ? [attachment] : [];
    });
  }

  private broadcastPresence(config: RoomConfig, excludedSocket?: WebSocket): void {
    const members = this.members(excludedSocket)
      .sort((a, b) => (a.role === b.role ? a.joinedAt - b.joinedAt : a.role === "host" ? -1 : 1))
      .map(({ name, role }) => ({ name, role }));
    this.broadcast({ type: "presence", room: this.publicRoom(config), members });
  }

  private broadcast(payload: unknown, excludedSocket?: WebSocket): void {
    const message = JSON.stringify(payload);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === excludedSocket) continue;
      try {
        socket.send(message);
      } catch {
        // A close event will remove the disconnected socket.
      }
    }
  }
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);

  if (!ROOM_FEATURE_ENABLED) {
    return json({ error: "방 기능은 현재 비활성화되어 있습니다." }, { status: 404 });
  }

  if (request.method === "POST" && url.pathname === "/api/rooms") {
    const body = await readJson(request);
    const roomName = normalizeText(body.roomName, MAX_ROOM_NAME_LENGTH);
    const hostName = normalizeText(body.hostName, MAX_NAME_LENGTH);
    const password = typeof body.password === "string" ? body.password.slice(0, 64) : "";
    const isPrivate = body.isPrivate === true;
    if (!roomName || !hostName || !isGameType(body.gameType)) return json({ error: "필수 항목을 확인해주세요." }, { status: 400 });
    if (isPrivate && password.length < 4) return json({ error: "비밀번호는 4자 이상 입력해주세요." }, { status: 400 });

    const code = randomRoomCode();
    const room = env.ROOMS.getByName(code);
    const result = await room.createRoom({ roomName, hostName, gameType: body.gameType, isPrivate, password });
    log("info", "room_created", { code, gameType: body.gameType, isPrivate });
    return json({ code, ...result }, { status: 201 });
  }

  const code = parts[2]?.toUpperCase() ?? "";
  if (parts[0] !== "api" || parts[1] !== "rooms" || !/^[23456789A-HJ-NP-Z]{8}$/.test(code)) {
    return json({ error: "잘못된 방 코드입니다." }, { status: 404 });
  }
  const room = env.ROOMS.getByName(code);

  if (request.method === "POST" && parts[3] === "join") {
    const body = await readJson(request);
    const name = normalizeText(body.name, MAX_NAME_LENGTH);
    const password = typeof body.password === "string" ? body.password.slice(0, 64) : "";
    if (!name) return json({ error: "이름을 입력해주세요." }, { status: 400 });
    try {
      const result = await room.joinRoom(name, password);
      return json({ code, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "방에 입장할 수 없어요.";
      return json({ error: message }, { status: message.includes("비밀번호") ? 401 : 404 });
    }
  }

  if (request.method === "GET" && parts[3] === "websocket") {
    return room.fetch(request);
  }

  return json({ error: "찾을 수 없는 요청입니다." }, { status: 404 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(request, env);
      const invitePath = url.pathname.match(/^\/room\/([2-9A-HJ-NP-Z]{8})\/?$/i);
      if (invitePath && (request.method === "GET" || request.method === "HEAD")) {
        return Response.redirect(new URL(`/?invite=${invitePath[1].toUpperCase()}`, url), 302);
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "잠시 후 다시 시도해주세요.";
      log("error", "request_failed", { path: url.pathname, error: message });
      return json({ error: message }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
