import assert from "node:assert/strict";
import test from "node:test";
import { newNunchi, startNunchi, advanceNunchi, tapNunchi, cancelNunchi, nunchiAlarm, publicNunchi, COLLISION_MS, NUNCHI_TURN_MS } from "../src/nunchi.ts";

const players = ["a", "b", "c", "d"].map(player_id => ({ player_id, nickname: `친구 ${player_id}` }));
function playing(count = 4) {
  const round = startNunchi(newNunchi(), players.slice(0, count), 1000);
  advanceNunchi(round, 4000);
  return round;
}

test("countdown rejects early taps and freezes the round roster", () => {
  const round = startNunchi(newNunchi(), players, 1000);
  assert.equal(nunchiAlarm(round), 4000);
  assert.ok(tapNunchi(round, "a", 1, 1, 3999));
  assert.equal(advanceNunchi(round, 3999), false);
  assert.equal(advanceNunchi(round, 4000), true);
  assert.equal(tapNunchi(round, "a", 1, 1, 4000), null);
  assert.ok(tapNunchi(round, "late-joiner", 1, 1, 4001));
});

test("all taps inside a fixed window lose together without exposing pending claims", () => {
  const round = playing();
  assert.equal(tapNunchi(round, "a", 1, 1, 4100), null);
  assert.equal(tapNunchi(round, "b", 1, 1, 4200), null);
  assert.equal(tapNunchi(round, "c", 1, 1, 4399), null);
  assert.equal("pending" in publicNunchi(round), false);
  assert.deepEqual(publicNunchi(round).claims, []);
  assert.equal(publicNunchi(round, "a").your_tap_pending, true);
  assert.equal(publicNunchi(round, "d").your_tap_pending, false);
  assert.equal(nunchiAlarm(round), 4400);
  assert.equal(advanceNunchi(round, 4399), false);
  advanceNunchi(round, 4400);
  assert.deepEqual(round.result, { loser_ids: ["a", "b", "c"], reason: "collision", number: 1 });
  assert.equal(nunchiAlarm(round), null);
});

test("a successful tap claims one number and the last player loses automatically", () => {
  const round = playing(3);
  assert.equal(tapNunchi(round, "a", 1, 1, 4100), null);
  advanceNunchi(round, 4100 + COLLISION_MS);
  assert.deepEqual(round.claims, [{ player_id: "a", number: 1 }]);
  assert.ok(tapNunchi(round, "a", 1, 2, 4500));
  assert.equal(tapNunchi(round, "b", 1, 2, 4500), null);
  advanceNunchi(round, 4800);
  assert.deepEqual(round.result, { loser_ids: ["c"], reason: "last", number: 3 });
});

test("duplicate, stale and forged number submissions do not claim another number", () => {
  const round = playing();
  assert.ok(tapNunchi(round, "a", 0, 1, 4100));
  assert.ok(tapNunchi(round, "a", "1", 1, 4100));
  assert.ok(tapNunchi(round, "a", 1, 99, 4100));
  assert.equal(tapNunchi(round, "a", 1, 1, 4100), null);
  assert.ok(tapNunchi(round, "a", 1, 1, 4101));
  assert.deepEqual(round.pending.player_ids, ["a"]);
  advanceNunchi(round, 4400);
  assert.ok(tapNunchi(round, "b", 1, 1, 4500));
  assert.equal(round.pending, null);
});

test("the collision window ends before another number can be claimed", () => {
  const round = playing();
  tapNunchi(round, "a", 1, 1, 4100);
  advanceNunchi(round, 4400);
  assert.equal(tapNunchi(round, "b", 1, 2, 4400), null);
  advanceNunchi(round, 4700);
  assert.equal(round.phase, "playing");
  assert.equal(round.claims.length, 2);
});

test("no input times out, including delayed countdown and alarm delivery", () => {
  const round = startNunchi(newNunchi(), players, 1000);
  advanceNunchi(round, 4000 + NUNCHI_TURN_MS + 1000);
  assert.equal(round.phase, "finished");
  assert.deepEqual(round.result.loser_ids, players.map(player => player.player_id));
  assert.equal(round.result.reason, "timeout");
  assert.ok(tapNunchi(round, "a", 1, 1, 30_000));
});

test("a tap just before timeout still gets its complete collision window", () => {
  const round = playing();
  const first = round.deadline_ms - 1;
  assert.equal(tapNunchi(round, "a", 1, 1, first), null);
  advanceNunchi(round, first + 100);
  assert.equal(tapNunchi(round, "b", 1, 1, first + 100), null);
  advanceNunchi(round, first + COLLISION_MS);
  assert.equal(round.result.reason, "collision");
});

test("a departed participant cancels the round, spectators do not, and rematches reject old taps", () => {
  const round = playing();
  assert.equal(cancelNunchi(round, ["spectator"]), false);
  assert.equal(cancelNunchi(round, ["a"]), true);
  assert.equal(round.result.reason, "cancelled");
  assert.equal(nunchiAlarm(round), null);
  const next = startNunchi(round, players, 10_000);
  advanceNunchi(next, 13_000);
  assert.equal(next.round, 2);
  assert.ok(tapNunchi(next, "a", 1, 1, 13_000));
  assert.equal(tapNunchi(next, "a", 2, 1, 13_000), null);
});
