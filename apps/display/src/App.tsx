import { useEffect, useMemo, useRef, useState } from "react";
import { useCoreDisplayState } from "./coreDisplay";
import { SceneDebugPanel } from "./SceneDebugPanel";
import {
  type DeviceProfile,
  mapTouchPoint,
  pointInVisibleRegion,
  validateDeviceProfile,
  visibleRegionClipPath,
} from "./deviceProfile";

type PointerState = { x: number; y: number; accepted: boolean } | null;

export function App() {
  const [profileNames, setProfileNames] = useState<string[]>([]);
  const [profileName, setProfileName] = useState("");
  const [profile, setProfile] = useState<DeviceProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showMask, setShowMask] = useState(true);
  const [showSafeArea, setShowSafeArea] = useState(true);
  const [pointer, setPointer] = useState<PointerState>(null);
  const [panelScale, setPanelScale] = useState(1);
  const panelRef = useRef<HTMLDivElement>(null);
  const coreDisplay = useCoreDisplayState();

  useEffect(() => {
    fetch("/profiles/index.json")
      .then((response) => {
        if (!response.ok)
          throw new Error(`Profile index failed: ${response.status}`);
        return response.json() as Promise<{ profiles: string[] }>;
      })
      .then(({ profiles }) => {
        setProfileNames(profiles);
        setProfileName(profiles[0] ?? "");
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  }, []);

  useEffect(() => {
    if (!profileName) return;
    setError(null);
    setPointer(null);
    fetch(`/profiles/${profileName}`)
      .then((response) => {
        if (!response.ok)
          throw new Error(`Profile load failed: ${response.status}`);
        return response.json();
      })
      .then((value: unknown) => setProfile(validateDeviceProfile(value)))
      .catch((reason: unknown) => {
        setProfile(null);
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  }, [profileName]);

  const display = profile?.display.present ? profile.display : null;

  useEffect(() => {
    if (!display || !panelRef.current) return;
    const panel = panelRef.current;
    const updateScale = () =>
      setPanelScale(
        panel.getBoundingClientRect().width / display.logicalSize.width,
      );
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [display]);

  const panelStyle = useMemo(() => {
    if (!display) return undefined;
    return {
      aspectRatio: `${display.logicalSize.width} / ${display.logicalSize.height}`,
    } as React.CSSProperties;
  }, [display]);

  const logicalStyle = useMemo(() => {
    if (!display) return undefined;
    return {
      width: `${display.logicalSize.width}px`,
      height: `${display.logicalSize.height}px`,
      transform: `scale(${panelScale})`,
    } as React.CSSProperties;
  }, [display, panelScale]);

  const maskStyle = useMemo(() => {
    if (!display) return undefined;
    return {
      clipPath: visibleRegionClipPath(
        display.visibleRegion,
        display.logicalSize,
      ),
    } as React.CSSProperties;
  }, [display]);

  function handlePointer(event: React.PointerEvent<HTMLDivElement>) {
    if (!display || !profile?.touch.present || !panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    const sourceX =
      ((event.clientX - rect.left) / rect.width) *
      profile.touch.sourceSize.width;
    const sourceY =
      ((event.clientY - rect.top) / rect.height) *
      profile.touch.sourceSize.height;
    const { x, y } = mapTouchPoint(
      sourceX,
      sourceY,
      profile.touch,
      display.logicalSize,
    );
    const accepted =
      !profile.touch.rejectOutsideVisibleRegion ||
      pointInVisibleRegion(display.visibleRegion, x, y);
    setPointer({ x, y, accepted });
  }

  return (
    <main className="simulator-shell">
      <header className="toolbar">
        <div>
          <p className="eyebrow">Totem developer tool</p>
          <h1>Display simulator</h1>
        </div>
        <label>
          Device profile
          <select
            value={profileName}
            onChange={(event) => setProfileName(event.target.value)}
          >
            {profileNames.map((name) => (
              <option key={name} value={name}>
                {name.replace(/\.json$/, "")}
              </option>
            ))}
          </select>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={showMask}
            onChange={(event) => setShowMask(event.target.checked)}
          />{" "}
          Mask hidden pixels
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={showSafeArea}
            onChange={(event) => setShowSafeArea(event.target.checked)}
          />{" "}
          Safe area
        </label>
      </header>

      {error && (
        <div className="error-panel" role="alert">
          {error}
        </div>
      )}

      {profile && !profile.display.present && (
        <section className="headless-card">
          <p className="eyebrow">{profile.id}</p>
          <h2>{profile.name}</h2>
          <p>
            This profile is intentionally headless. Display rendering is
            disabled while developer tooling remains available.
          </p>
        </section>
      )}

      {profile && display && (
        <div className="workspace">
          <section className="stage">
            <div
              aria-label="Simulated touch display"
              className="panel-frame"
              ref={panelRef}
              role="application"
              style={panelStyle}
              onPointerMove={handlePointer}
              onPointerDown={handlePointer}
            >
              <div className="logical-panel" style={logicalStyle}>
                <div
                  className={`product-output ${showMask ? "masked" : ""}`}
                  style={showMask ? maskStyle : undefined}
                >
                  <div
                    className="ambient-scene"
                    data-core-scene={coreDisplay.activeSceneId ?? "ambient"}
                    data-led-semantic={coreDisplay.led.semantic}
                  >
                    <div
                      className="orb"
                      style={{
                        opacity: Math.max(0.2, coreDisplay.led.intensity),
                      }}
                    />
                    <p className="eyebrow">
                      {coreDisplay.activeSceneId &&
                      coreDisplay.activeSceneId !== "ambient"
                        ? coreDisplay.activeSceneId
                        : "Ambient"}
                    </p>
                    <h2>Totem</h2>
                    <p>{profile.name}</p>
                  </div>
                </div>
                {showSafeArea && (
                  <div
                    className="safe-area"
                    style={{
                      left: `${display.contentSafeArea.x}px`,
                      top: `${display.contentSafeArea.y}px`,
                      width: `${display.contentSafeArea.width}px`,
                      height: `${display.contentSafeArea.height}px`,
                    }}
                  >
                    <span>content safe area</span>
                  </div>
                )}
                {!showMask && (
                  <div className="visible-outline" style={maskStyle} />
                )}
                {pointer && (
                  <div
                    className={`pointer-dot ${pointer.accepted ? "accepted" : "rejected"}`}
                    style={{ left: `${pointer.x}px`, top: `${pointer.y}px` }}
                  />
                )}
              </div>
            </div>
          </section>

          <aside className="inspector">
            <p className="eyebrow">Profile</p>
            <h2>{profile.name}</h2>
            <dl>
              <div>
                <dt>Logical</dt>
                <dd>
                  {display.logicalSize.width} × {display.logicalSize.height}
                </dd>
              </div>
              <div>
                <dt>Panel</dt>
                <dd>
                  {display.panel.nativeWidth} × {display.panel.nativeHeight}
                </dd>
              </div>
              <div>
                <dt>Visible</dt>
                <dd>{display.visibleRegion.shape}</dd>
              </div>
              <div>
                <dt>Touch</dt>
                <dd>{profile.touch.present ? "enabled" : "disabled"}</dd>
              </div>
            </dl>
            <div className="touch-readout">
              <strong>Pointer as touch</strong>
              <span>
                {pointer
                  ? `${pointer.x.toFixed(0)}, ${pointer.y.toFixed(0)} · ${pointer.accepted ? "accepted" : "rejected"}`
                  : profile.touch.present
                    ? "Move over the panel"
                    : "Touch disabled"}
              </span>
            </div>
            <div>
              <p className="eyebrow">Virtual lighting</p>
              {profile.lighting.zones.length === 0 ? (
                <p className="muted">No lighting zones</p>
              ) : (
                <div className="lighting-zones">
                  {profile.lighting.zones.map((zone) => (
                    <span key={zone.id}>
                      {zone.id} · {zone.kind}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="core-scene-readout">
              <p className="eyebrow">Core-driven scene</p>
              <strong>{coreDisplay.activeSceneId ?? "—"}</strong>
              <span>
                LED {coreDisplay.led.semantic} · {coreDisplay.led.effect} ·{" "}
                {Math.round(coreDisplay.led.intensity * 100)}%
              </span>
              <span className="muted">
                {coreDisplay.connected
                  ? coreDisplay.lastEventAt
                    ? `updated ${new Date(coreDisplay.lastEventAt).toLocaleTimeString()}`
                    : "connected to core"
                  : "core stream offline"}
              </span>
            </div>
            <SceneDebugPanel />
          </aside>
        </div>
      )}
    </main>
  );
}
