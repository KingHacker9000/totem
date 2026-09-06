import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type DeviceProfile,
  validateDeviceProfile,
  visibleRegionClipPath,
} from "./deviceProfile";

type ContributionView = {
  extensionId: string;
  contributionId: string;
  surface: "display" | "dashboard";
  title: string;
  state: string;
  data?: unknown;
};

type ContributionSnapshot = {
  display: ContributionView[];
};

function concise(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (Array.isArray(value))
    return value.length === 0 ? "None" : `${value.length} items`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const preferred = [
      "display",
      "condition",
      "temperatureC",
      "activeCount",
      "platform",
    ];
    const selected = preferred
      .map((key) => entries.find(([entryKey]) => entryKey === key))
      .filter((entry): entry is [string, unknown] => entry !== undefined)
      .slice(0, 2);
    if (selected.length > 0) {
      return selected
        .map(([key, item]) => `${key}: ${concise(item)}`)
        .join(" · ");
    }
    return entries
      .slice(0, 2)
      .map(([key, item]) => `${key}: ${concise(item)}`)
      .join(" · ");
  }
  return String(value);
}

export function ContributionDisplay() {
  const [profileNames, setProfileNames] = useState<string[]>([]);
  const [profileName, setProfileName] = useState("");
  const [profile, setProfile] = useState<DeviceProfile | null>(null);
  const [views, setViews] = useState<ContributionView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [panelScale, setPanelScale] = useState(1);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/profiles/index.json")
      .then((response) => response.json() as Promise<{ profiles: string[] }>)
      .then(({ profiles }) => {
        setProfileNames(profiles);
        setProfileName(profiles[0] ?? "");
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
  }, []);

  useEffect(() => {
    if (!profileName) return;
    fetch(`/profiles/${profileName}`)
      .then((response) => {
        if (!response.ok)
          throw new Error(`Profile load failed (${response.status})`);
        return response.json();
      })
      .then((value: unknown) => setProfile(validateDeviceProfile(value)))
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
  }, [profileName]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/extensions/contributions", {
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Contribution request failed (${response.status})`);
      }
      const snapshot = (await response.json()) as ContributionSnapshot;
      setViews(snapshot.display);
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load display contributions",
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

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

  const panelStyle = useMemo(
    () =>
      display
        ? ({
            aspectRatio: `${display.logicalSize.width} / ${display.logicalSize.height}`,
          } as React.CSSProperties)
        : undefined,
    [display],
  );

  return (
    <main className="simulator-shell">
      <header className="toolbar">
        <div>
          <p className="eyebrow">Generic extension presentation host</p>
          <h1>Contribution display</h1>
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
        <a href="/">Simulator</a>
      </header>

      {error ? (
        <div className="error-panel" role="alert">
          {error}
        </div>
      ) : null}

      {profile && !profile.display.present ? (
        <section className="headless-card">
          <h2>{profile.name}</h2>
          <p>
            This device profile is headless, so display contributions are
            intentionally not mounted.
          </p>
        </section>
      ) : null}

      {profile && display ? (
        <div className="workspace">
          <section className="stage">
            <div className="panel-frame" ref={panelRef} style={panelStyle}>
              <div
                className="logical-panel"
                style={{
                  width: `${display.logicalSize.width}px`,
                  height: `${display.logicalSize.height}px`,
                  transform: `scale(${panelScale})`,
                  transformOrigin: "top left",
                  clipPath: visibleRegionClipPath(
                    display.visibleRegion,
                    display.logicalSize,
                  ),
                }}
              >
                <div className="ambient-scene">
                  <p className="eyebrow">Extension surface</p>
                  <h2>Totem</h2>
                </div>
                <section
                  aria-label="Extension contribution safe area"
                  style={{
                    position: "absolute",
                    left: `${display.contentSafeArea.x}px`,
                    top: `${display.contentSafeArea.y}px`,
                    width: `${display.contentSafeArea.width}px`,
                    height: `${display.contentSafeArea.height}px`,
                    display: "grid",
                    gap: "12px",
                    alignContent: "center",
                    overflow: "hidden",
                    padding: "12px",
                    boxSizing: "border-box",
                  }}
                >
                  {views.length === 0 ? (
                    <div className="touch-readout">
                      <strong>No granted display contributions</strong>
                      <span>
                        Grant display.present to an enabled compatible extension.
                      </span>
                    </div>
                  ) : (
                    views.slice(0, 4).map((view) => (
                      <div
                        className="touch-readout"
                        key={`${view.extensionId}:${view.contributionId}`}
                      >
                        <strong>{view.title}</strong>
                        <span>{concise(view.data)}</span>
                        <span className="muted">{view.extensionId}</span>
                      </div>
                    ))
                  )}
                </section>
              </div>
            </div>
          </section>
          <aside className="inspector">
            <p className="eyebrow">Safe-area contract</p>
            <h2>{profile.name}</h2>
            <p>
              Contributions are mounted only inside{" "}
              {display.contentSafeArea.width} × {display.contentSafeArea.height}
              at ({display.contentSafeArea.x}, {display.contentSafeArea.y}).
            </p>
            <p>{views.length} display contribution(s) currently granted by core.</p>
          </aside>
        </div>
      ) : null}
    </main>
  );
}
