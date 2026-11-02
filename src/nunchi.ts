export const COLLISION_MS = 300;
export const NUNCHI_TURN_MS = 15_000;

export interface NunchiState {
  round: number;
  phase: "waiting" | "countdown" | "playing" | "finished";
  participant_ids: string[];
  names: Record<string, string>;
  starts_at_ms: number;
  deadline_ms: number;
  claims: { player_id: string; number: number }[];
  pending: { player_ids: string[]; closes_at_ms: number } | null;
  result: { loser_ids: string[]; reason: "collision" | "last" | "timeout" | "cancelled"; number: number } | null;
}

export function newNunchi(round = 0): NunchiState {
  return { round, phase: "waiting", participant_ids: [], names: {}, starts_at_ms: 0, deadline_ms: 0, claims: [], pending: null, result: null };
}

export function startNunchi(previous: NunchiState, players: { player_id: string; nickname: string }[], now: number): NunchiState {
  return {
    ...newNunchi(previous.round + 1), phase: "countdown",
    participant_ids: players.map(player => player.player_id),
    names: Object.fromEntries(players.map(player => [player.player_id, player.nickname])),
    starts_at_ms: now + 3000, deadline_ms: now + 3000 + NUNCHI_TURN_MS,
  };
}

function finish(state: NunchiState, loser_ids: string[], reason: NonNullable<NunchiState["result"]>["reason"]): void {
  state.result = { loser_ids, reason, number: state.claims.length + 1 };
  state.phase = "finished";
  state.pending = null;
}

export function remainingNunchi(state: NunchiState): string[] {
  return state.participant_ids.filter(id => !state.claims.some(claim => claim.player_id === id));
}

// Arrival times and a fixed collision window are owned by the server.
export function advanceNunchi(state: NunchiState, now: number): boolean {
  let changed = false;
  if (state.phase === "countdown" && now >= state.starts_at_ms) {
    state.phase = "playing";
    changed = true;
  }
  if (state.phase !== "playing") return changed;
  if (state.pending && now >= state.pending.closes_at_ms) {
    const pending = state.pending;
    state.pending = null;
    if (pending.player_ids.length > 1) finish(state, pending.player_ids, "collision");
    else {
      state.claims.push({ player_id: pending.player_ids[0], number: state.claims.length + 1 });
      const remaining = remainingNunchi(state);
      if (remaining.length === 1) finish(state, remaining, "last");
      else state.deadline_ms = pending.closes_at_ms + NUNCHI_TURN_MS;
    }
    changed = true;
  }
  if (state.phase === "playing" && !state.pending && now >= state.deadline_ms) {
    finish(state, remainingNunchi(state), "timeout");
    changed = true;
  }
  return changed;
}

export function tapNunchi(state: NunchiState, playerId: string, round: unknown, number: unknown, now: number): string | null {
  if (round !== state.round || number !== state.claims.length + 1) return "현재 숫자를 확인하고 다시 눌러주세요.";
  if (state.phase !== "playing" || now < state.starts_at_ms || now >= (state.pending?.closes_at_ms ?? state.deadline_ms)) return "지금은 누를 수 없어요.";
  if (!state.participant_ids.includes(playerId) || state.claims.some(claim => claim.player_id === playerId) || state.pending?.player_ids.includes(playerId)) return "이번 라운드에서는 한 번만 누를 수 있어요.";
  if (!state.pending) state.pending = { player_ids: [], closes_at_ms: now + COLLISION_MS };
  state.pending.player_ids.push(playerId);
  return null;
}

export function cancelNunchi(state: NunchiState, playerIds: string[]): boolean {
  if (!["countdown", "playing"].includes(state.phase) || !playerIds.some(id => state.participant_ids.includes(id))) return false;
  finish(state, [], "cancelled");
  return true;
}

export function nunchiAlarm(state: NunchiState): number | null {
  if (state.phase === "countdown") return state.starts_at_ms;
  if (state.phase === "playing") return state.pending?.closes_at_ms ?? state.deadline_ms;
  return null;
}

export function publicNunchi(state: NunchiState, playerId?: string): Omit<NunchiState, "pending"> & { your_tap_pending: boolean } {
  const { pending: _pending, ...visible } = state;
  return { ...visible, your_tap_pending: Boolean(playerId && state.pending?.player_ids.includes(playerId)) };
}
