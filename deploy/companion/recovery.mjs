// Automatic recovery is limited to the display; sensitive core actions stay separate.
export function displayRecoveryDecision(
  state,
  { enabled, now, started, lastBeat },
) {
  state.displayRecovery ??= { attempts: [], lastResult: null };
  const recovery = state.displayRecovery;
  recovery.attempts = recovery.attempts.filter((at) => at > now - 3600000);
  if (!enabled || now - started <= 90000 || now - lastBeat <= 60000)
    return "wait";
  const lastAttempt = recovery.attempts.at(-1);
  if (lastAttempt !== undefined && now - lastAttempt < 90000) return "wait";
  return recovery.attempts.length < 2 ? "restart" : "escalate";
}
export function recordDisplayRecovery(state, now) {
  state.displayRecovery.attempts.push(now);
}
