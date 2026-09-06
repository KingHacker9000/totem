import { useMemo, useState } from "react";
import "./SceneDebugPanel.css";
import {
  SceneArbiter,
  type SceneSnapshot,
  type VirtualLedState,
  ledChangedEvent,
  publishDisplayEvent,
  sceneChangedEvent,
} from "./sceneState";

const AMBIENT_REQUEST = {
  id: "ambient",
  sceneId: "ambient",
  priority: 0,
  requestedAt: 0,
} as const;

export function SceneDebugPanel() {
  const arbiter = useMemo(() => new SceneArbiter(), []);
  const [scene, setScene] = useState<SceneSnapshot>(() =>
    arbiter.request(AMBIENT_REQUEST),
  );
  const [led, setLed] = useState<VirtualLedState>({
    semantic: "idle",
    effect: "breathe",
    intensity: 0.35,
  });

  function commitScene(next: SceneSnapshot) {
    setScene(next);
    publishDisplayEvent(sceneChangedEvent(next));
  }

  function requestNotification() {
    commitScene(
      arbiter.request({
        id: "notification",
        sceneId: "notification",
        priority: 50,
        requestedAt: Date.now(),
      }),
    );
  }

  function requestCritical() {
    commitScene(
      arbiter.request({
        id: "critical",
        sceneId: "critical-alert",
        priority: 100,
        requestedAt: Date.now(),
      }),
    );
  }

  function releaseOverride() {
    if (!scene.active || scene.active.id === AMBIENT_REQUEST.id) return;
    commitScene(arbiter.release(scene.active.id));
  }

  function setLedState(next: VirtualLedState) {
    setLed(next);
    publishDisplayEvent(ledChangedEvent(next));
  }

  return (
    <section className="scene-debug">
      <p className="eyebrow">Scene arbitration</p>
      <div className="scene-active">
        <strong>{scene.active?.sceneId ?? "none"}</strong>
        <span>priority {scene.active?.priority ?? "—"}</span>
      </div>
      <div className="debug-actions">
        <button type="button" onClick={requestNotification}>
          Notification
        </button>
        <button type="button" onClick={requestCritical}>
          Critical alert
        </button>
        <button type="button" onClick={releaseOverride}>
          Release active
        </button>
      </div>
      <ul className="scene-stack" aria-label="Scene request stack">
        {scene.requests.map((request) => (
          <li key={request.id}>
            {request.sceneId} · p{request.priority}
          </li>
        ))}
      </ul>

      <p className="eyebrow led-heading">Virtual LED</p>
      <div
        className={`virtual-led virtual-led-${led.effect}`}
        data-semantic={led.semantic}
        style={{ opacity: Math.max(0.15, led.intensity) }}
        title={`${led.semantic} / ${led.effect} / ${Math.round(led.intensity * 100)}%`}
      />
      <div className="led-readout">
        {led.semantic} · {led.effect} · {Math.round(led.intensity * 100)}%
      </div>
      <div className="debug-actions">
        <button
          type="button"
          onClick={() =>
            setLedState({
              semantic: "idle",
              effect: "breathe",
              intensity: 0.35,
            })
          }
        >
          Idle
        </button>
        <button
          type="button"
          onClick={() =>
            setLedState({
              semantic: "attention",
              effect: "pulse",
              intensity: 0.85,
            })
          }
        >
          Attention
        </button>
        <button
          type="button"
          onClick={() =>
            setLedState({
              semantic: "success",
              effect: "solid",
              intensity: 0.7,
            })
          }
        >
          Success
        </button>
      </div>
      <p className="muted event-note">
        Changes emit normalized <code>display.scene_changed</code> and{" "}
        <code>display.led_changed</code> events on the local simulator event
        seam.
      </p>
    </section>
  );
}
