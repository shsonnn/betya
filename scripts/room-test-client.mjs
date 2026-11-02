import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const WebSocket = createRequire(require.resolve("wrangler"))("ws");

export function roomTestClient(origin) {
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname), "Tests must only use a local server");
  const memberships = [], sockets = [];
  async function post(path, body, cookie = "") {
    const response = await fetch(`${origin}${path}`, { method: "POST", headers: { "content-type": "application/json", origin, cookie }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie };
  }
  function connect(code, cookie) {
    const ws = new WebSocket(`${origin.replace("http", "ws")}/api/rooms/${code}/ws`, { headers: { Cookie: cookie, Origin: origin } });
    sockets.push(ws);
    const messages = [];
    ws.on("message", data => { if (data.toString() !== "pong") messages.push(JSON.parse(data)); });
    ws.on("error", error => messages.push({ type: "socket.error", payload: { message: error.message } }));
    async function next(type, predicate = () => true, timeout = 6000) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const index = messages.findIndex(message => message.type === type && predicate(message.payload));
        if (index >= 0) return messages.splice(index, 1)[0].payload;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error(`Timed out waiting for ${type}: ${JSON.stringify(messages.slice(-4))}`);
    }
    return { ws, next, send: (type, payload = {}) => ws.send(JSON.stringify({ type, payload })) };
  }
  async function create(game_type) {
    const response = await post("/api/rooms", { room_name: `${game_type} QA`, nickname: "방장", visibility: "public", game_type });
    assert.equal(response.status, 201);
    memberships.push([response.body.room.code, response.cookie]);
    return response;
  }
  async function join(code, nickname) {
    const response = await post(`/api/rooms/${code}/join`, { nickname });
    assert.equal(response.status, 200);
    memberships.push([code, response.cookie]);
    return response;
  }
  async function close() {
    for (const ws of sockets) ws.close();
    for (const [code, cookie] of memberships.reverse()) await post(`/api/rooms/${code}/leave`, {}, cookie);
  }
  return { post, connect, create, join, close };
}
