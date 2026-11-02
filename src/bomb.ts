export const BOMB_COOLDOWN_MS = 700;

export interface BombState {
  round: number;
  phase: "waiting" | "countdown" | "playing" | "finished";
  participant_ids: string[];
  names: Record<string, string>;
  holder_id: string | null;
  starts_at_ms: number;
  explodes_at_ms: number;
  pass_available_at_ms: number;
  turn: number;
  last_pass: { from_id: string; to_id: string } | null;
  result: { loser_id: string | null; reason: "exploded" | "left" | "cancelled" } | null;
}

export function newBomb(round = 0): BombState {
  return { round, phase: "waiting", participant_ids: [], names: {}, holder_id: null, starts_at_ms: 0, explodes_at_ms: 0, pass_available_at_ms: 0, turn: 0, last_pass: null, result: null };
}

export function startBomb(previous: BombState, players: { player_id: string; nickname: string }[], now: number, randomInt: (max: number) => number): BombState {
  const starts = now + 3000;
  return {
    ...newBomb(previous.round + 1), phase: "countdown",
    participant_ids: players.map(player => player.player_id),
    names: Object.fromEntries(players.map(player => [player.player_id, player.nickname])),
    holder_id: players[randomInt(players.length)].player_id,
    starts_at_ms: starts, explodes_at_ms: starts + 12_000 + randomInt(13_001),
    pass_available_at_ms: starts + BOMB_COOLDOWN_MS,
  };
}

export function advanceBomb(state: BombState, now: number): boolean {
  let changed = false;
  if (state.phase === "countdown" && now >= state.starts_at_ms) {
    state.phase = "playing";
    changed = true;
  }
  if (state.phase === "playing" && now >= state.explodes_at_ms) {
    state.phase = "finished";
    state.result = { loser_id: state.holder_id, reason: "exploded" };
    changed = true;
  }
  return changed;
}

export function passBomb(state: BombState, playerId: string, target: unknown, round: unknown, turn: unknown, now: number): string | null {
  if (round !== state.round || turn !== state.turn) return "폭탄이 이미 다른 사람에게 넘어갔어요.";
  if (state.phase !== "playing" || now < state.starts_at_ms || now >= state.explodes_at_ms) return "지금은 폭탄을 넘길 수 없어요.";
  if (state.holder_id !== playerId) return "폭탄을 가진 사람만 넘길 수 있어요.";
  if (now < state.pass_available_at_ms) return "잠깐! 폭탄을 받은 뒤 조금만 기다려주세요.";
  if (typeof target !== "string" || target === playerId || !state.participant_ids.includes(target)) return "폭탄을 받을 다른 참가자를 골라주세요.";
  state.last_pass = { from_id: playerId, to_id: target };
  state.holder_id = target;
  state.pass_available_at_ms = now + BOMB_COOLDOWN_MS;
  state.turn += 1;
  return null;
}

export function removeBombPlayers(state: BombState, playerIds: string[]): boolean {
  if (!["countdown", "playing"].includes(state.phase) || !playerIds.some(id => state.participant_ids.includes(id))) return false;
  state.participant_ids = state.participant_ids.filter(id => !playerIds.includes(id));
  if (state.holder_id && playerIds.includes(state.holder_id)) {
    state.phase = "finished";
    state.result = { loser_id: state.holder_id, reason: "left" };
  } else if (state.participant_ids.length < 2) {
    state.phase = "finished";
    state.result = { loser_id: null, reason: "cancelled" };
  }
  return true;
}

export function bombAlarm(state: BombState): number | null {
  if (state.phase === "countdown") return state.starts_at_ms;
  if (state.phase === "playing") return state.explodes_at_ms;
  return null;
}

// A reconnect or an ordinary game update must never reveal the fuse.
export function publicBomb(state: BombState): Omit<BombState, "explodes_at_ms"> {
  const { explodes_at_ms: _fuse, ...visible } = state;
  return visible;
}
