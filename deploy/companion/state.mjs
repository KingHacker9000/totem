import { randomUUID } from "node:crypto";

export const ENUMS = {
  mood: [
    "neutral",
    "pleased",
    "smug",
    "confused",
    "concerned",
    "excited",
    "annoyed",
    "alarmed",
  ],
  activity: [
    "idle",
    "attentive",
    "listening",
    "thinking",
    "working",
    "speaking",
    "sleeping",
    "celebrating",
    "focus",
  ],
  accessory: ["none", "sunglasses", "laptop", "clock"],
  reaction: [
    "boop",
    "blink",
    "wake",
    "success",
    "error",
    "curious",
    "celebrate",
    "sunglasses_tilt",
  ],
  severity: ["info", "attention", "urgent", "critical"],
};
const rank = { info: 0, attention: 1, urgent: 2, critical: 3 };
function queueAdmission(queue, source, severity) {
  const sourceFull =
    queue.filter((event) => event.source === source).length >= 16;
  if (!sourceFull && queue.length < 128) return { allowed: true };
  const victim = queue
    .filter(
      (event) =>
        (!sourceFull || event.source === source) &&
        rank[event.severity] < rank[severity],
    )
    .sort((a, b) => rank[a.severity] - rank[b.severity] || a.at - b.at)[0];
  return { allowed: !!victim, victim };
}
export function checkObject(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("expected object");
  if (Object.keys(value).some((k) => !allowed.includes(k)))
    throw new Error("unknown argument");
}
export function text(value, limit = 240) {
  if (typeof value !== "string" || !value.trim() || value.length > limit)
    throw new Error("invalid text");
  return value.trim();
}
export function number(value, min, max) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error("invalid number");
  return value;
}
function choice(value, name) {
  if (!ENUMS[name].includes(value)) throw new Error(`invalid ${name}`);
  return value;
}
export function initial() {
  return {
    version: 1,
    avatar: {
      mood: "neutral",
      activity: "idle",
      energy: 0.8,
      accessory: "none",
      lookAt: { x: 0, y: 0 },
    },
    events: [],
    history: [],
    outbox: [],
    deliveries: [],
    focus: null,
    approvals: [],
    audit: [],
    reaction: null,
    transientUntil: 0,
    displayRecovery: { attempts: [], lastResult: null },
    alertSourceOrder: [],
  };
}
export class Companion {
  constructor(saved, clock = Date.now) {
    this.clock = clock;
    this.state = saved || initial();
    if (this.state.version !== 1) throw new Error("unsupported state version");
    if (this.state.focus && !this.state.focus.id) {
      this.state.focus.id = String(this.state.focus.until);
      this.state.focus.duration = Math.max(1, this.state.focus.until - clock());
      this.state.focus.remaining = this.state.focus.duration;
      this.state.focus.paused = false;
      this.state.focus.label = "";
    }
    this.state.alertSourceOrder ??= [];
    if (
      !Array.isArray(this.state.alertSourceOrder) ||
      this.state.alertSourceOrder.length > 128 ||
      this.state.alertSourceOrder.some((source) => typeof source !== "string")
    )
      throw new Error("invalid alert source order");
    for (const key of [
      "events",
      "history",
      "outbox",
      "deliveries",
      "approvals",
      "audit",
    ]) {
      if (!Array.isArray(this.state[key]))
        throw new Error("invalid saved state");
    }
    checkObject(this.state.avatar, [
      "mood",
      "activity",
      "energy",
      "accessory",
      "lookAt",
    ]);
    for (const key of ["mood", "activity", "accessory"])
      choice(this.state.avatar[key], key);
    number(this.state.avatar.energy, 0, 1);
    this.state.displayRecovery ??= {
      attempts: this.state.audit
        .filter(
          (e) => e.action === "auto-restart-display" && Number.isFinite(e.at),
        )
        .map((e) => e.at)
        .sort((a, b) => a - b)
        .slice(-2),
      lastResult: null,
    };
    if (
      !Array.isArray(this.state.displayRecovery.attempts) ||
      this.state.displayRecovery.attempts.some((at) => !Number.isFinite(at))
    )
      throw new Error("invalid display recovery state");
    this.tick();
    const sourceCounts = new Map();
    this.state.outbox = [...this.state.outbox]
      .sort((a, b) => rank[b.severity] - rank[a.severity] || a.at - b.at)
      .filter((event) => {
        const count = sourceCounts.get(event.source) || 0;
        if (count >= 16) return false;
        sourceCounts.set(event.source, count + 1);
        return true;
      })
      .slice(0, 128);
  }
  command(command, args = {}, source = "local") {
    const s = this.state,
      now = this.clock();
    switch (command) {
      case "totem.avatar.set_state": {
        checkObject(args, ["mood", "activity", "energy", "accessory"]);
        const next = { ...s.avatar };
        for (const key of ["mood", "activity", "accessory"])
          if (key in args) next[key] = choice(args[key], key);
        if ("energy" in args) next.energy = number(args.energy, 0, 1);
        s.avatar = next;
        s.transientUntil = [
          "thinking",
          "listening",
          "speaking",
          "celebrating",
        ].includes(s.avatar.activity)
          ? now + 30000
          : 0;
        break;
      }
      case "totem.avatar.look_at":
        checkObject(args, ["x", "y"]);
        s.avatar.lookAt = {
          x: number(args.x, -1, 1),
          y: number(args.y, -1, 1),
        };
        break;
      case "totem.avatar.react":
        checkObject(args, ["reaction"]);
        s.reaction = {
          name: choice(args.reaction, "reaction"),
          at: now,
          id: randomUUID(),
        };
        if (args.reaction === "wake") {
          s.avatar.activity = "idle";
          s.transientUntil = 0;
        }
        break;
      case "totem.notify":
        return this.event(args, source);
      case "totem.show_card":
        return this.event(args, source, true);
      case "totem.dismiss": {
        checkObject(args, ["id"]);
        const id = text(args.id, 100);
        const event = s.events.find((e) => e.id === id);
        if (!event) throw new Error("unknown event");
        s.alertSourceOrder = [
          ...s.alertSourceOrder.filter((item) => item !== event.source),
          event.source,
        ].slice(-128);
        s.events = s.events.filter((e) => e.id !== id);
        s.outbox = s.outbox.filter((e) => e.id !== id);
        s.history.push({
          id,
          source: event.source,
          dedupeKey: event.dedupeKey,
          at: now,
        });
        s.history = s.history.slice(-512);
        s.audit.push({ action: "acknowledge", id, source, at: now });
        break;
      }
      case "totem.snooze": {
        checkObject(args, ["id", "minutes"]);
        const id = text(args.id, 100),
          minutes = number(args.minutes, 1, 60);
        const event = s.events.find((item) => item.id === id);
        if (!event) throw new Error("unknown event");
        if (event.severity === "critical")
          throw new Error("cannot snooze critical alert");
        event.snoozedUntil = now + minutes * 60000;
        if (event.expiresAt)
          event.expiresAt =
            event.snoozedUntil + Math.max(3000, event.expiresAt - now);
        s.outbox = s.outbox.filter((item) => item.id !== id);
        s.audit.push({ action: "snooze", id, source, at: now });
        break;
      }
      case "totem.focus": {
        checkObject(args, ["minutes", "kind", "label"]);
        const minutes = number(args.minutes, 0, 180);
        if (args.kind !== undefined && !["focus", "break"].includes(args.kind))
          throw new Error("invalid kind");
        const label =
          args.label === undefined || args.label === ""
            ? ""
            : text(args.label, 120);
        s.focus = minutes
          ? {
              id: randomUUID(),
              until: now + minutes * 60000,
              duration: minutes * 60000,
              remaining: minutes * 60000,
              paused: false,
              label,
              kind: args.kind || "focus",
            }
          : null;
        s.focusChangedAt = now;
        s.avatar.activity = minutes ? "focus" : "idle";
        s.transientUntil = 0;
        break;
      }
      case "totem.focus.sync": {
        checkObject(args, ["timer", "at", "completed", "id"]);
        const at = number(args.at, now - 86400000, now + 1000);
        if (args.completed !== undefined && typeof args.completed !== "boolean")
          throw new Error("invalid completion");
        if (args.id !== undefined) text(args.id, 100);
        let timer = null;
        if (args.timer !== null) {
          const value = args.timer;
          checkObject(value, [
            "id",
            "kind",
            "label",
            "duration",
            "endsAt",
            "remaining",
            "paused",
          ]);
          const id = text(value.id, 100),
            label =
              value.label === undefined || value.label === ""
                ? ""
                : text(value.label, 120);
          if (
            !["focus", "break"].includes(value.kind) ||
            typeof value.paused !== "boolean"
          )
            throw new Error("invalid timer");
          const duration = number(value.duration, 1, 10800000);
          const remaining = number(value.remaining, 0, duration);
          const until = number(value.endsAt, now - 86400000, now + 10800000);
          timer = {
            id,
            label,
            kind: value.kind,
            duration,
            remaining,
            paused: value.paused,
            until,
          };
        }
        if (at < (s.focusChangedAt || 0)) return { ok: true, ignored: true };
        if (
          args.completed &&
          s.focus?.id === args.id &&
          !s.focus.paused &&
          now >= s.focus.until
        ) {
          this.tick();
          return { ok: true };
        }
        // An offline pause/end before completion supersedes that inferred finish.
        // Automatic completion does not outrank a later explicit user intent.
        if (!args.completed && (timer?.paused || !timer || timer.until > now)) {
          const timerId = timer?.id || args.id;
          const cancelled = s.events.filter(
            (event) => event.source === "timer" && event.timerId === timerId,
          );
          const ids = new Set(cancelled.map((event) => event.id));
          s.events = s.events.filter((event) => !ids.has(event.id));
          s.outbox = s.outbox.filter((event) => !ids.has(event.id));
        }
        s.focus = timer;
        s.focusChangedAt = at;
        s.avatar.activity = timer ? "focus" : "idle";
        s.transientUntil = 0;
        this.tick();
        break;
      }
      default:
        throw new Error("unsupported command");
    }
    s.audit = s.audit.slice(-256);
    if (source === "muse" && command !== "totem.avatar.react")
      s.reaction = { name: "curious", at: now, id: randomUUID() };
    return { ok: true };
  }
  event(args, source, requested = false) {
    checkObject(args, [
      "source",
      "type",
      "severity",
      "title",
      "detail",
      "dedupeKey",
      "ttlSeconds",
      "pinned",
      "proactive",
    ]);
    const now = this.clock();
    const key = text(args.dedupeKey || randomUUID(), 100),
      origin = text(args.source || source, 64);
    const severity = choice(args.severity || "attention", "severity");
    const title = text(args.title, 90),
      detail = args.detail === undefined ? "" : text(args.detail, 300);
    for (const flag of ["pinned", "proactive"])
      if (flag in args && typeof args[flag] !== "boolean")
        throw new Error("invalid flag");
    const ttl = number(args.ttlSeconds ?? 30, 3, 86400);
    const type = text(args.type || "notification", 40);
    const previous = this.state.events.find(
      (e) => e.source === origin && e.dedupeKey === key,
    );
    if (previous) return { ok: true, id: previous.id, deduplicated: true };
    if (
      this.state.history.some(
        (e) =>
          e.source === origin && e.dedupeKey === key && now - e.at < 86400000,
      )
    )
      return { ok: true, deduplicated: true };
    const admission = queueAdmission(this.state.events, origin, severity);
    if (!admission.allowed) return { ok: false, error: "event queue full" };
    if (admission.victim) {
      const victim = admission.victim;
      this.state.events = this.state.events.filter((e) => e.id !== victim.id);
      this.state.outbox = this.state.outbox.filter((e) => e.id !== victim.id);
      this.state.history.push({
        id: victim.id,
        source: victim.source,
        dedupeKey: victim.dedupeKey,
        at: now,
        reason: "priority-replaced",
      });
      this.state.history = this.state.history.slice(-512);
    }
    const event = {
      id: randomUUID(),
      source: origin,
      origin: source,
      requested,
      type,
      severity,
      title,
      detail,
      dedupeKey: key,
      at: now,
      expiresAt:
        args.pinned || severity === "critical" ? null : now + ttl * 1000,
    };
    this.state.events.push(event);
    let proactiveQueued = false;
    if (args.proactive !== false && rank[severity] >= 1 && source !== "muse") {
      const delivery = queueAdmission(this.state.outbox, origin, severity);
      if (delivery.allowed) {
        if (delivery.victim)
          this.state.outbox = this.state.outbox.filter(
            (e) => e.id !== delivery.victim.id,
          );
        this.state.outbox.push({
          ...event,
          attempts: 0,
          nextAttempt: now,
          deliveryExpiresAt: now + 86400000,
        });
        proactiveQueued = true;
      }
    }
    return { ok: true, id: event.id, proactiveQueued };
  }
  tick() {
    const now = this.clock(),
      s = this.state;
    if (s.transientUntil && now >= s.transientUntil) {
      s.avatar.activity = "idle";
      s.transientUntil = 0;
    }
    if (s.focus && !s.focus.paused && now >= s.focus.until) {
      const finished = s.focus;
      s.focus = null;
      s.avatar.activity = "idle";
      s.reaction = { name: "celebrate", at: now, id: randomUUID() };
      const completed = this.event(
        {
          source: "timer",
          title:
            finished.kind === "break" ? "Ready to focus" : "Time for a break",
          detail: "Your timer is complete.",
          severity: "attention",
          dedupeKey: `timer-${finished.until}-${finished.kind}`,
          ttlSeconds: 60,
        },
        "timer",
      );
      const notice = s.events.find((event) => event.id === completed.id);
      if (notice) notice.timerId = finished.id || String(finished.until);
    }
    for (const e of s.events)
      if (e.expiresAt && e.expiresAt <= now)
        s.history.push({
          id: e.id,
          source: e.source,
          dedupeKey: e.dedupeKey,
          at: now,
        });
    s.history = s.history.slice(-512);
    s.events = s.events.filter((e) => !e.expiresAt || e.expiresAt > now);
    s.outbox = s.outbox.filter((e) => e.deliveryExpiresAt > now);
    s.approvals = s.approvals.filter((e) => e.expiresAt > now);
    s.deliveries = s.deliveries.filter((e) => now - e.at < 3600000);
  }
  snapshot() {
    this.tick();
    const s = this.state;
    const sourceOrder = Array.isArray(s.alertSourceOrder)
      ? s.alertSourceOrder
      : [];
    const events = [...s.events].sort(
      (a, b) =>
        rank[b.severity] - rank[a.severity] ||
        sourceOrder.indexOf(a.source) - sourceOrder.indexOf(b.source) ||
        a.at - b.at,
    );
    const quiet =
      new Date(this.clock()).getHours() < 7 ||
      new Date(this.clock()).getHours() >= 22;
    const visible = events.filter(
      (e) =>
        (!e.snoozedUntil || e.snoozedUntil <= this.clock()) &&
        (e.requested ||
          rank[e.severity] >= 2 ||
          (!s.focus && !quiet && e.severity !== "info")),
    );
    return {
      avatar: s.avatar,
      reaction: s.reaction,
      events,
      card: visible[0] || null,
      focus: s.focus,
      approvals: s.approvals,
      quiet,
      updatedAt: this.clock(),
    };
  }
  nextDelivery() {
    this.tick();
    const now = this.clock(),
      s = this.state;
    if (s.deliveries.length >= 6) return null;
    return (
      [...s.outbox]
        .sort((a, b) => rank[b.severity] - rank[a.severity] || a.at - b.at)
        .find(
          (e) =>
            e.nextAttempt <= now &&
            s.deliveries.filter((d) => d.source === e.source).length < 2 &&
            (!this.snapshot().quiet || rank[e.severity] >= 2),
        ) || null
    );
  }
  delivered(id, deliveredSource) {
    const event = this.state.outbox.find((e) => e.id === id);
    const source = event?.source || deliveredSource;
    if (source)
      this.state.deliveries.push({
        source: text(source, 64),
        at: this.clock(),
      });
    this.state.outbox = this.state.outbox.filter((e) => e.id !== id);
  }
}
