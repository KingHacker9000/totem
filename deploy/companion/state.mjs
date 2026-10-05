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
  };
}
export class Companion {
  constructor(saved, clock = Date.now) {
    this.clock = clock;
    this.state = saved || initial();
    if (this.state.version !== 1) throw new Error("unsupported state version");
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
    this.tick();
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
      case "totem.focus": {
        checkObject(args, ["minutes", "kind"]);
        const minutes = number(args.minutes, 0, 180);
        if (args.kind !== undefined && !["focus", "break"].includes(args.kind))
          throw new Error("invalid kind");
        s.focus = minutes
          ? { until: now + minutes * 60000, kind: args.kind || "focus" }
          : null;
        s.avatar.activity = minutes ? "focus" : "idle";
        s.transientUntil = 0;
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
    if (
      this.state.events.filter((e) => e.source === origin).length >= 16 ||
      this.state.events.length >= 128
    ) {
      return { ok: false, error: "event queue full" };
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
    if (args.proactive !== false && rank[severity] >= 1 && source !== "muse") {
      if (this.state.outbox.length < 128)
        this.state.outbox.push({
          ...event,
          attempts: 0,
          nextAttempt: now,
          deliveryExpiresAt: now + 86400000,
        });
    }
    return { ok: true, id: event.id };
  }
  tick() {
    const now = this.clock(),
      s = this.state;
    if (s.transientUntil && now >= s.transientUntil) {
      s.avatar.activity = "idle";
      s.transientUntil = 0;
    }
    if (s.focus && now >= s.focus.until) {
      const finished = s.focus;
      s.focus = null;
      s.avatar.activity = "idle";
      s.reaction = { name: "celebrate", at: now, id: randomUUID() };
      this.event(
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
    const events = [...s.events].sort(
      (a, b) => rank[b.severity] - rank[a.severity] || a.at - b.at,
    );
    const quiet =
      new Date(this.clock()).getHours() < 7 ||
      new Date(this.clock()).getHours() >= 22;
    const visible = events.filter(
      (e) =>
        e.requested ||
        rank[e.severity] >= 2 ||
        (!s.focus && !quiet && e.severity !== "info"),
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
  delivered(id) {
    const event = this.state.outbox.find((e) => e.id === id);
    if (event)
      this.state.deliveries.push({ source: event.source, at: this.clock() });
    this.state.outbox = this.state.outbox.filter((e) => e.id !== id);
  }
}
