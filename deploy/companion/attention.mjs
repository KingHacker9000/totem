// Existing Pi connector attention -> companion event, without connector UI code.
export function normalizeAttention(record) {
  if (!record || typeof record !== "object")
    throw new Error("invalid attention record");
  const severities = {
    info: "info",
    success: "attention",
    warning: "attention",
    error: "urgent",
    critical: "critical",
  };
  const expiresAt = record.expiresAt ? Date.parse(record.expiresAt) : null;
  if (record.expiresAt && !Number.isFinite(expiresAt))
    throw new Error("invalid expiry");
  return {
    source: record.connectorId,
    type: "notification",
    severity: severities[record.severity] || "info",
    title: record.title,
    detail: record.body || undefined,
    dedupeKey: record.id,
    ttlSeconds: expiresAt
      ? Math.max(3, Math.min(86400, (expiresAt - Date.now()) / 1000))
      : 60,
    pinned: record.severity === "critical",
  };
}
export function sourceReference(record) {
  if (
    typeof record?.connectorId !== "string" ||
    typeof record?.id !== "string" ||
    !/^[A-Za-z0-9._-]{1,64}$/.test(record?.connectorId) ||
    !/^[A-Za-z0-9._:-]{1,96}$/.test(record?.id)
  )
    throw new Error("invalid attention reference");
  return { connectorId: record.connectorId, recordId: record.id };
}
export function attentionPath(reference) {
  return `/desk/attention/${encodeURIComponent(reference.connectorId)}/${encodeURIComponent(reference.recordId)}`;
}
