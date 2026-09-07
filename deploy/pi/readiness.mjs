export function readinessOptions(env = process.env) {
  return {
    timeoutMs: positiveNumber(env.TOTEM_READY_TIMEOUT_MS, 15_000),
    initialDelayMs: positiveNumber(env.TOTEM_READY_INITIAL_DELAY_MS, 150),
    maxDelayMs: positiveNumber(env.TOTEM_READY_MAX_DELAY_MS, 1_500),
    requestTimeoutMs: positiveNumber(env.TOTEM_READY_REQUEST_TIMEOUT_MS, 2_000),
  };
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function waitForCoreReady({
  baseUrl,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  ...overrides
}) {
  const defaults = readinessOptions();
  const timeoutMs = overrides.timeoutMs ?? defaults.timeoutMs;
  const initialDelayMs = overrides.initialDelayMs ?? defaults.initialDelayMs;
  const maxDelayMs = overrides.maxDelayMs ?? defaults.maxDelayMs;
  const requestTimeoutMs = overrides.requestTimeoutMs ?? defaults.requestTimeoutMs;
  const startedAt = now();
  let attempts = 0;
  let delayMs = initialDelayMs;
  let last = null;

  while (now() - startedAt <= timeoutMs) {
    attempts += 1;
    try {
      const response = await fetchImpl(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      const text = await response.text();
      last = { status: response.status, body: text };
      if (response.ok) {
        return { ok: true, attempts, elapsedMs: now() - startedAt, last };
      }
    } catch (error) {
      last = {
        status: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const elapsed = now() - startedAt;
    if (elapsed >= timeoutMs) break;
    await sleep(Math.min(delayMs, Math.max(0, timeoutMs - elapsed)));
    delayMs = Math.min(maxDelayMs, Math.ceil(delayMs * 1.6));
  }

  return { ok: false, attempts, elapsedMs: now() - startedAt, last };
}
