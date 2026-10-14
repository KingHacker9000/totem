import { randomUUID } from "node:crypto";

// Acknowledgement deduplicates one ongoing incident. Recovery ends that incident;
// a later failure must be visible even within the ordinary deduplication window.
export function observeHealthEvents(companion, conditions) {
  companion.state.healthIncidents ??= {};
  const incidents = companion.state.healthIncidents;
  for (const [key, alert] of Object.entries(conditions)) {
    if (!alert) {
      delete incidents[key];
      continue;
    }
    if (!incidents[key]) {
      // Adopt a still-visible legacy alert instead of duplicating it on upgrade.
      const legacy = companion.state.events.find(
        (event) => event.source === "system" && event.dedupeKey === key,
      );
      incidents[key] = { dedupeKey: legacy ? key : `${key}:${randomUUID()}` };
    }
    companion.event(
      { ...alert, source: "system", dedupeKey: incidents[key].dedupeKey },
      "system",
    );
  }
}
