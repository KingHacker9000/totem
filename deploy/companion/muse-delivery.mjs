// The paired main chat is valid without a session_id. Arbitrary locally named
// side chats can pass SDK validation but the Muse server rejects them with 400.
export function deliveryMessage(event) {
  return {
    message: `Totem ${event.severity}: ${event.title}. ${event.detail} Alert ID: ${event.id}. Use totem.dismiss to acknowledge.`,
  };
}
export function deliveryStatus(result, at = Date.now()) {
  return {
    status: result.ok ? "accepted" : "failed",
    at,
    httpStatus: Number.isInteger(result.status) ? result.status : null,
    code:
      typeof result.response?.error?.code === "string"
        ? result.response.error.code.slice(0, 64)
        : null,
  };
}

export function reconnectOutbox(
  outbox,
  wasConnected,
  connected,
  now = Date.now(),
) {
  if (!wasConnected && connected) {
    for (const event of outbox)
      event.nextAttempt = Math.min(event.nextAttempt, now);
  }
}
