import { useEffect, useState } from "react";
import {
  normalizeLedState,
  type VirtualLedState,
  publishDisplayEvent,
  type DisplayRuntimeEvent,
} from "./sceneState";

export interface CoreDisplayState {
  connected: boolean;
  activeSceneId: string | null;
  led: VirtualLedState;
  lastEventAt: string | null;
}

const IDLE_LED: VirtualLedState = {
  semantic: "idle",
  effect: "breathe",
  intensity: 0.35,
};

function parseLed(payload: unknown): VirtualLedState | null {
  if (typeof payload !== "object" || payload === null) return null;
  const candidate = payload as Record<string, unknown>;
  if (
    typeof candidate.semantic !== "string" ||
    typeof candidate.effect !== "string" ||
    typeof candidate.intensity !== "number"
  ) {
    return null;
  }
  try {
    return normalizeLedState({
      semantic: candidate.semantic as VirtualLedState["semantic"],
      effect: candidate.effect as VirtualLedState["effect"],
      intensity: candidate.intensity,
    });
  } catch {
    return null;
  }
}

/**
 * Subscribes to core's runtime event stream and mirrors the authoritative
 * display scene/LED state that core derives from task lifecycle. Core is the
 * source of truth; the simulator only reflects it.
 */
export function useCoreDisplayState(): CoreDisplayState {
  const [state, setState] = useState<CoreDisplayState>({
    connected: false,
    activeSceneId: null,
    led: IDLE_LED,
    lastEventAt: null,
  });

  useEffect(() => {
    let disposed = false;
    const source = new EventSource("/api/events");

    source.onopen = () => {
      if (!disposed) setState((prev) => ({ ...prev, connected: true }));
    };
    source.onerror = () => {
      if (!disposed) setState((prev) => ({ ...prev, connected: false }));
    };

    source.addEventListener("display.scene_changed", (message) => {
      if (disposed) return;
      try {
        const event = JSON.parse(
          (message as MessageEvent<string>).data,
        ) as DisplayRuntimeEvent;
        const sceneId =
          (event.payload as { activeSceneId?: string | null }).activeSceneId ??
          null;
        setState((prev) => ({
          ...prev,
          activeSceneId: sceneId,
          lastEventAt: event.occurredAt,
        }));
        // Re-broadcast onto the in-page simulator seam so local scene tooling
        // and any listeners observe the same normalized event.
        publishDisplayEvent(event);
      } catch {
        // ignore malformed frames
      }
    });

    source.addEventListener("display.led_changed", (message) => {
      if (disposed) return;
      try {
        const event = JSON.parse(
          (message as MessageEvent<string>).data,
        ) as DisplayRuntimeEvent;
        const led = parseLed(event.payload);
        if (!led) return;
        setState((prev) => ({
          ...prev,
          led,
          lastEventAt: event.occurredAt,
        }));
        publishDisplayEvent(event);
      } catch {
        // ignore malformed frames
      }
    });

    return () => {
      disposed = true;
      source.close();
    };
  }, []);

  return state;
}
