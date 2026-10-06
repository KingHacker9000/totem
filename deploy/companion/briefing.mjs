const MAX_AGE = 2 * 60 * 60 * 1000;
const clean = (value, limit = 100) =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";

export function commitments(navigation, now = Date.now()) {
  const widgets = Array.isArray(navigation?.widgets) ? navigation.widgets : [];
  const catalog = Array.isArray(navigation?.catalog) ? navigation.catalog : [];
  const sources = ["academic:due-this-week", "calendar:next-event"].map(
    (id) => {
      const widget = widgets.find((w) => w?.id === id);
      const source = catalog.find((entry) => entry.id === id.split(":")[0]);
      const updated = Date.parse(widget?.updatedAt);
      const available =
        !!widget &&
        widget.health === "ok" &&
        (!source || (source.enabled !== false && source.health === "ok")) &&
        Number.isFinite(updated) &&
        now - updated <= MAX_AGE &&
        updated <= now + 60000;
      if (!available) return { source: id.split(":")[0], available: false };
      const academic = id.startsWith("academic:");
      const at = Date.parse(
        academic ? widget.data?.nextDueAt : widget.data?.start,
      );
      const title = academic
        ? [clean(widget.data?.nextCourse, 40), clean(widget.data?.nextName)]
            .filter(Boolean)
            .join(" · ")
        : clean(widget.title);
      return {
        source: academic ? "academic" : "calendar",
        available: true,
        item:
          Number.isFinite(at) && title
            ? { at, title, kind: academic ? "Due" : "Event" }
            : null,
      };
    },
  );
  return {
    items: sources
      .flatMap((s) => (s.item ? [s.item] : []))
      .sort((a, b) => a.at - b.at),
    unavailable: sources.filter((s) => !s.available).map((s) => s.source),
  };
}

export function briefingDetail(
  navigation,
  { now = Date.now(), timezone, next = false } = {},
) {
  const { items, unavailable } = commitments(navigation, now);
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const selected = next ? items.slice(0, 1) : items;
  const lines = selected.map(
    (item) => `${item.kind}: ${item.title} · ${format.format(item.at)}`,
  );
  if (!lines.length)
    lines.push(
      unavailable.length
        ? "Upcoming commitments unavailable."
        : "No upcoming commitments reported.",
    );
  if (unavailable.length && lines[0] !== "Upcoming commitments unavailable.")
    lines.push(`${unavailable.join(" and ")} data unavailable.`);
  return lines.join("\n").slice(0, 300);
}

// Service timezone also governs quiet hours. Use the same timezone for daily keys.
export function scheduleWindow(now, schedule, timezone) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule || "")) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
  const [hour, minute] = schedule.split(":").map(Number);
  const elapsed =
    Number(parts.hour) * 60 + Number(parts.minute) - hour * 60 - minute;
  return elapsed >= 0 && elapsed < 90
    ? `${parts.year}-${parts.month}-${parts.day}`
    : null;
}

export function maybeBriefing(companion, navigation, schedule, timezone) {
  const now = companion.clock();
  const day = scheduleWindow(now, schedule, timezone);
  if (
    !day ||
    companion.state.briefing?.lastDay === day ||
    companion.snapshot().quiet ||
    companion.state.focus
  )
    return false;
  const { unavailable } = commitments(navigation, now);
  // Retry within the morning window when sources are down; never publish a fake empty day.
  if (unavailable.length === 2) return false;
  const result = companion.event(
    {
      source: "briefing",
      type: "briefing",
      title: "Your day",
      detail: briefingDetail(navigation, { now, timezone }),
      severity: "attention",
      ttlSeconds: 60,
      proactive: false,
      dedupeKey: `briefing-${day}`,
    },
    "schedule",
  );
  if (!result.ok) return false;
  companion.state.briefing = { lastDay: day };
  return true;
}
