import assert from "node:assert/strict";
import test from "node:test";
import { newBomb, startBomb, advanceBomb, passBomb, removeBombPlayers, bombAlarm, publicBomb, BOMB_COOLDOWN_MS } from "../src/bomb.ts";

const players = ["a", "b", "c"].map(player_id => ({ player_id, nickname: `친구 ${player_id}` }));
function playing() {
  const round = startBomb(newBomb(), players, 1000, () => 0);
  advanceBomb(round, 4000);
  return round;
}

test("countdown chooses a holder and keeps the fuse secret in all snapshots", () => {
  const round = startBomb(newBomb(), players, 1000, () => 0);
  assert.equal(round.holder_id, "a");
  assert.equal(round.explodes_at_ms, 16_000);
  assert.equal(bombAlarm(round), 4000);
  assert.equal("explodes_at_ms" in publicBomb(round), false);
  assert.ok(passBomb(round, "a", "b", 1, 0, 3999));
  advanceBomb(round, 4000);
  assert.equal(round.phase, "playing");
  assert.equal(bombAlarm(round), 16_000);
  assert.equal("explodes_at_ms" in publicBomb(round), false);
});

test("only the holder can pass, to another participant, after the cooldown", () => {
  const round = playing();
  assert.ok(passBomb(round, "a", "b", 1, 0, 4699));
  assert.ok(passBomb(round, "b", "c", 1, 0, 4700));
  assert.ok(passBomb(round, "a", "a", 1, 0, 4700));
  assert.ok(passBomb(round, "a", "spectator", 1, 0, 4700));
  assert.equal(passBomb(round, "a", "b", 1, 0, 4700), null);
  assert.equal(round.holder_id, "b");
  assert.equal(round.turn, 1);
  assert.equal(round.pass_available_at_ms, 4700 + BOMB_COOLDOWN_MS);
  assert.equal(passBomb(round, "b", "c", 1, 1, 5400), null);
  assert.equal(round.holder_id, "c");
});

test("turn and round tokens stop replayed handoffs even after the holder gets the bomb again", () => {
  const round = playing();
  passBomb(round, "a", "b", 1, 0, 4700);
  passBomb(round, "b", "a", 1, 1, 5400);
  assert.ok(passBomb(round, "a", "b", 1, 0, 6100));
  assert.ok(passBomb(round, "a", "b", 0, 2, 6100));
  assert.ok(passBomb(round, "a", "b", "1", 2, 6100));
  assert.equal(passBomb(round, "a", "c", 1, 2, 6100), null);
});

test("a handoff cannot extend or disclose the original fuse", () => {
  const round = playing();
  const fuse = round.explodes_at_ms;
  passBomb(round, "a", "b", 1, 0, 4700);
  assert.equal(round.explodes_at_ms, fuse);
  assert.equal("explodes_at_ms" in publicBomb(round), false);
  advanceBomb(round, fuse - 1);
  assert.equal(round.result, null);
  advanceBomb(round, fuse);
  assert.deepEqual(round.result, { loser_id: "b", reason: "exploded" });
  assert.equal(bombAlarm(round), null);
});

test("the server rejects handoffs at or after detonation even before a delayed alarm runs", () => {
  const round = playing();
  assert.ok(passBomb(round, "a", "b", 1, 0, round.explodes_at_ms));
  assert.equal(round.holder_id, "a");
  advanceBomb(round, round.explodes_at_ms + 5000);
  assert.equal(round.result.loser_id, "a");
});

test("late countdown alarms still detonate the bomb", () => {
  const round = startBomb(newBomb(), players, 1000, () => 0);
  advanceBomb(round, 50_000);
  assert.equal(round.phase, "finished");
  assert.equal(round.result.loser_id, "a");
});

test("leaving with the bomb loses and preserves the departing player's name", () => {
  const round = playing();
  assert.equal(removeBombPlayers(round, ["spectator"]), false);
  assert.equal(removeBombPlayers(round, ["a"]), true);
  assert.deepEqual(round.result, { loser_id: "a", reason: "left" });
  assert.equal(round.names.a, "친구 a");
  assert.equal(bombAlarm(round), null);
});

test("departing nonholders are removed from targets and too few players cancel the round", () => {
  const round = playing();
  removeBombPlayers(round, ["c"]);
  assert.equal(round.phase, "playing");
  assert.ok(passBomb(round, "a", "c", 1, 0, 4700));
  removeBombPlayers(round, ["b"]);
  assert.deepEqual(round.result, { loser_id: null, reason: "cancelled" });
});

test("rematches use a new round and select from the full allowed fuse range", () => {
  const round = playing();
  advanceBomb(round, round.explodes_at_ms);
  const next = startBomb(round, players, 20_000, max => max - 1);
  assert.equal(next.round, 2);
  assert.equal(next.holder_id, "c");
  assert.equal(next.explodes_at_ms - next.starts_at_ms, 25_000);
  assert.equal(next.turn, 0);
  assert.equal(next.result, null);
});
