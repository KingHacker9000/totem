export type ScenePriority = number;

export interface SceneRequest {
  id: string;
  sceneId: string;
  priority: ScenePriority;
  requestedAt: number;
}

export interface SceneSnapshot {
  active: SceneRequest | null;
  requests: readonly SceneRequest[];
}

export type LedSemantic = "idle" | "attention" | "success" | "error";
export type LedEffect = "off" | "solid" | "pulse" | "breathe";

export interface VirtualLedState {
  semantic: LedSemantic;
  effect: LedEffect;
  intensity: number;
}

export type DisplayRuntimeEvent =
  | {
      schema: "totem.event/v0";
      id: string;
      type: "display.scene_changed";
      occurredAt: string;
      source: { kind: "core"; id: "display-runtime" };
      payload: {
        activeSceneId: string | null;
        activeRequestId: string | null;
        priority: number | null;
      };
    }
  | {
      schema: "totem.event/v0";
      id: string;
      type: "display.led_changed";
      occurredAt: string;
      source: { kind: "core"; id: "display-runtime" };
      payload: VirtualLedState;
    };

function compareRequests(left: SceneRequest, right: SceneRequest): number {
  if (left.priority !== right.priority) return right.priority - left.priority;
  if (left.requestedAt !== right.requestedAt)
    return right.requestedAt - left.requestedAt;
  return right.id.localeCompare(left.id);
}

export class SceneArbiter {
  readonly #requests = new Map<string, SceneRequest>();

  request(request: SceneRequest): SceneSnapshot {
    if (!Number.isFinite(request.priority))
      throw new Error("scene priority must be finite");
    if (!Number.isFinite(request.requestedAt))
      throw new Error("scene requestedAt must be finite");
    if (!request.id.trim() || !request.sceneId.trim())
      throw new Error("scene request id and sceneId are required");

    this.#requests.set(request.id, { ...request });
    return this.snapshot();
  }

  release(requestId: string): SceneSnapshot {
    this.#requests.delete(requestId);
    return this.snapshot();
  }

  snapshot(): SceneSnapshot {
    const requests = [...this.#requests.values()].sort(compareRequests);
    return { active: requests[0] ?? null, requests };
  }
}

export function normalizeLedState(state: VirtualLedState): VirtualLedState {
  if (!Number.isFinite(state.intensity))
    throw new Error("LED intensity must be finite");
  return { ...state, intensity: Math.min(1, Math.max(0, state.intensity)) };
}

function eventId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return `evt_${crypto.randomUUID()}`;
  return `evt_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function sceneChangedEvent(
  snapshot: SceneSnapshot,
  occurredAt = new Date().toISOString(),
): DisplayRuntimeEvent {
  return {
    schema: "totem.event/v0",
    id: eventId(),
    type: "display.scene_changed",
    occurredAt,
    source: { kind: "core", id: "display-runtime" },
    payload: {
      activeSceneId: snapshot.active?.sceneId ?? null,
      activeRequestId: snapshot.active?.id ?? null,
      priority: snapshot.active?.priority ?? null,
    },
  };
}

export function ledChangedEvent(
  state: VirtualLedState,
  occurredAt = new Date().toISOString(),
): DisplayRuntimeEvent {
  return {
    schema: "totem.event/v0",
    id: eventId(),
    type: "display.led_changed",
    occurredAt,
    source: { kind: "core", id: "display-runtime" },
    payload: normalizeLedState(state),
  };
}

export function publishDisplayEvent(event: DisplayRuntimeEvent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("totem:event", { detail: event }));
}
