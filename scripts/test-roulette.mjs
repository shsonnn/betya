// Integration smoke test against an isolated `wrangler dev --local` instance.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const WebSocket = createRequire(require.resolve("wrangler"))("ws");
const origin = process.env.BETYA_TEST_ORIGIN || "http://127.0.0.1:4186";
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname), "Tests must never create production rooms");
const memberships = [];
const sockets = [];
async function post(path, body, cookie = "") {
  const response = await fetch(`${origin}${path}`, { method: "POST", headers: { "content-type": "application/json", origin, cookie }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie };
}
function connect(code, cookie) {
  const ws = new WebSocket(`${origin.replace('http', 'ws')}/api/rooms/${code}/ws`, { headers: { Cookie: cookie, Origin: origin } });
  sockets.push(ws);
  const messages = [];
  ws.on("message", data => { if (data.toString() !== "pong") messages.push(JSON.parse(data)); });
  const next = async (type) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const index = messages.findIndex(message => message.type === type);
      if (index >= 0) return messages.splice(index, 1)[0].payload;
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    throw new Error(`Timed out waiting for ${type}`);
  };
  return { ws, next, send: (type, payload = {}) => ws.send(JSON.stringify({ type, payload })) };
}
try {
  const created = await post("/api/rooms", { room_name: "룰렛 QA <안전>", nickname: "방장", visibility: "private", password: "test-only", game_type: "roulette" });
  assert.equal(created.status, 201);
  const code = created.body.room.code;
  memberships.push([code, created.cookie]);
  assert.equal((await post(`/api/rooms/${code}/join`, { nickname: "참가자", password: "wrong" })).status, 401);
  const joined = await post(`/api/rooms/${code}/join`, { nickname: "참가자", password: "test-only" });
  assert.equal(joined.status, 200);
  memberships.push([code, joined.cookie]);
  const host = connect(code, created.cookie);
  const guest = connect(code, joined.cookie);
  assert.deepEqual((await host.next("room.snapshot")).game.items, ["", ""]);
  assert.equal((await guest.next("room.snapshot")).game.type, "roulette");
  host.send("game.spin");
  assert.equal((await host.next("error")).code, "INVALID_STATE");
  host.send("game.configure", { items: Array(25).fill("초과") });
  assert.equal((await host.next("error")).code, "INVALID_INPUT");
  host.send("game.configure", { items: [" 민수 ", "지연", "", "현우", "민수"] });
  const a = await host.next("game.updated"), b = await guest.next("game.updated");
  assert.deepEqual(a.game, b.game);
  assert.deepEqual(a.game.items, ["민수", "지연", "", "현우", "민수"]);
  guest.send("game.spin");
  assert.equal((await guest.next("error")).code, "FORBIDDEN");
  guest.send("game.configure", { items: ["변경", "불가"] });
  assert.equal((await guest.next("error")).code, "FORBIDDEN");
  host.send("game.spin");
  const first = await host.next("game.spun"), second = await guest.next("game.spun");
  assert.deepEqual(first.game, second.game);
  const spin = first.game.spin;
  assert.ok(spin.winner_index >= 0 && spin.winner_index < 4);
  assert.ok(spin.duration_ms >= 7200 && spin.duration_ms <= 8400);
  assert.equal(first.game.animation_until_ms, spin.started_at_ms + spin.duration_ms);
  for (const [type, payload] of [["game.spin", {}], ["game.configure", { items: ["바꿈", "불가"] }], ["game.reset", {}]]) {
    host.send(type, payload);
    assert.equal((await host.next("error")).code, "INVALID_STATE");
  }
  guest.ws.close();
  const rejoined = connect(code, joined.cookie);
  assert.deepEqual((await rejoined.next("room.snapshot")).game, first.game);
  host.send("chat.typing", { typing: true });
  assert.equal((await rejoined.next("chat.typing")).typing, true);
  const invite = await fetch(`${origin}/room/${code}?share=3`);
  assert.equal(invite.status, 200);
  assert.equal(invite.headers.get("cache-control"), "no-store");
  assert.match(await invite.text(), /<base href="\/">/);
  await new Promise(resolve => setTimeout(resolve, Math.max(0, first.game.animation_until_ms - Date.now() + 80)));
  host.send("game.spin");
  const reroll = await host.next("game.spun");
  assert.ok(reroll.game.revision > first.game.revision);
  assert.ok(reroll.game.spin.started_at_ms > spin.started_at_ms);
  // The three established game types must still initialize and accept their CTA.
  for (const [game_type, configure, action] of [
    ["dice", { player_count: 2, names: ["가", "나"] }, "game.roll"],
    ["random_pick", { items: ["가", "나"], pick_count: 1 }, "game.draw"],
    ["teams", { people: ["가", "나"], pairs: [], team_count: 2 }, "game.divide"],
  ]) {
    const result = await post("/api/rooms", { room_name: "회귀 QA", nickname: "테스트", visibility: "public", game_type });
    assert.equal(result.status, 201);
    memberships.push([result.body.room.code, result.cookie]);
    const peer = connect(result.body.room.code, result.cookie);
    assert.equal((await peer.next("room.snapshot")).game.type, game_type);
    peer.send("game.configure", configure); await peer.next("game.updated");
    peer.send(action);
    await peer.next({ "game.roll": "game.rolled", "game.draw": "game.drawn", "game.divide": "game.divided" }[action]);
  }
  console.log("PASS: roulette sync, permissions, bounds, spin lock, reconnect, reroll, typing, invitations, and 3-game regression");
} finally {
  for (const ws of sockets) ws.close();
  for (const [code, cookie] of memberships.reverse()) await post(`/api/rooms/${code}/leave`, {}, cookie);
}
