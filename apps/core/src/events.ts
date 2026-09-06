import type { TotemEvent } from "@totem/protocol";

export type RuntimeEventListener = (event: TotemEvent) => void;

/**
 * Minimal in-process publish/subscribe seam for runtime events.
 *
 * Phase 1 only needs to fan a normalized event stream out to connected browser
 * clients (dashboard, display simulator) over Server-Sent Events. This hub keeps
 * no history; late subscribers only receive events published after they attach.
 */
export class RuntimeEventHub {
  readonly #listeners = new Set<RuntimeEventListener>();

  subscribe(listener: RuntimeEventListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  publish(event: TotemEvent): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch {
        // A slow or broken subscriber must not stall event delivery for others.
      }
    }
  }

  get subscriberCount(): number {
    return this.#listeners.size;
  }
}
