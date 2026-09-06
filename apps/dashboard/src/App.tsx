import { useEffect, useMemo, useState } from "react";

type ConnectionState = "connecting" | "live" | "reconnecting" | "offline";

type RuntimeStatus = {
  status: "ok";
  name: "Totem";
  stage: "phase-1";
  environment: string;
  startedAt: string;
  uptimeSeconds: number;
  pid: number;
  nodeVersion: string;
  dataDir: string;
};

type CoreStatusEvent = {
  type: "core.status";
  occurredAt: string;
  data: RuntimeStatus;
};

const sections = [
  "Overview",
  "Tasks",
  "Extensions",
  "Themes",
  "Agents",
  "Display",
  "Speech",
  "Security",
  "Storage",
  "Logs / Developer",
] as const;

type Section = (typeof sections)[number];

function formatUptime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function statusLabel(state: ConnectionState) {
  switch (state) {
    case "live":
      return "Live";
    case "connecting":
      return "Connecting";
    case "reconnecting":
      return "Reconnecting";
    case "offline":
      return "Core offline";
  }
}

export function App() {
  const [section, setSection] = useState<Section>("Overview");
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;

    const loadInitialStatus = async () => {
      try {
        const response = await fetch("/api/status", { headers: { accept: "application/json" } });
        if (!response.ok) {
          throw new Error(`Core status request failed (${response.status})`);
        }
        const data = (await response.json()) as RuntimeStatus;
        if (!disposed) {
          setRuntime(data);
          setError(null);
        }
      } catch (cause) {
        if (!disposed) {
          setConnection("offline");
          setError(cause instanceof Error ? cause.message : "Unable to reach Totem core");
        }
      }
    };

    void loadInitialStatus();

    const source = new EventSource("/api/events");
    source.onopen = () => {
      if (!disposed) {
        setConnection("live");
        setError(null);
      }
    };
    source.addEventListener("core.status", (message) => {
      if (disposed) return;
      try {
        const event = JSON.parse((message as MessageEvent<string>).data) as CoreStatusEvent;
        setRuntime(event.data);
        setLastEventAt(event.occurredAt);
        setConnection("live");
        setError(null);
      } catch {
        setError("Received an invalid core status event");
      }
    });
    source.onerror = () => {
      if (!disposed) {
        setConnection((current) => (current === "live" ? "reconnecting" : "offline"));
        setError("Live event stream interrupted; retrying automatically.");
      }
    };

    return () => {
      disposed = true;
      source.close();
    };
  }, []);

  const started = useMemo(
    () => (runtime ? new Date(runtime.startedAt).toLocaleString() : "—"),
    [runtime],
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">T</span>
          <div>
            <strong>Totem</strong>
            <span>Control Center</span>
          </div>
        </div>

        <nav aria-label="Dashboard sections">
          {sections.map((item) => (
            <button
              className={item === section ? "nav-item active" : "nav-item"}
              key={item}
              onClick={() => setSection(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className={`connection-dot ${connection}`} />
          <div>
            <strong>{statusLabel(connection)}</strong>
            <span>{runtime?.environment ?? "local core"}</span>
          </div>
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Phase 1 · PC development</p>
            <h1>{section}</h1>
          </div>
          <div className={`connection-pill ${connection}`}>
            <span className={`connection-dot ${connection}`} />
            {statusLabel(connection)}
          </div>
        </header>

        {section === "Overview" ? (
          <div className="overview-grid">
            {error ? <div className="notice">{error}</div> : null}

            <section className="hero-card">
              <div>
                <p className="eyebrow">Core runtime</p>
                <h2>{runtime ? `${runtime.name} is ${runtime.status}` : "Connecting to Totem core"}</h2>
                <p>
                  This dashboard observes the local core process. Runtime state comes from
                  <code> /api/status</code> and the reconnecting <code>/api/events</code> stream.
                </p>
              </div>
              <div className="hero-status">
                <span className={`pulse ${connection}`} />
                <strong>{runtime?.stage ?? "phase-1"}</strong>
                <small>{lastEventAt ? `Last event ${new Date(lastEventAt).toLocaleTimeString()}` : "Awaiting event"}</small>
              </div>
            </section>

            <section className="metric-card">
              <span>Uptime</span>
              <strong>{runtime ? formatUptime(runtime.uptimeSeconds) : "--:--:--"}</strong>
              <small>Started {started}</small>
            </section>
            <section className="metric-card">
              <span>Runtime</span>
              <strong>{runtime?.nodeVersion ?? "—"}</strong>
              <small>PID {runtime?.pid ?? "—"}</small>
            </section>
            <section className="metric-card wide">
              <span>Data directory</span>
              <strong className="path-value">{runtime?.dataDir ?? "Waiting for core status…"}</strong>
              <small>Portable local storage root</small>
            </section>

            <section className="phase-card">
              <div>
                <p className="eyebrow">Available now</p>
                <h3>Live core observability</h3>
              </div>
              <ul>
                <li>Health and runtime status</li>
                <li>Automatic SSE reconnect</li>
                <li>Responsive desktop navigation shell</li>
              </ul>
            </section>

            <section className="phase-card muted-card">
              <div>
                <p className="eyebrow">Owned by later tasks</p>
                <h3>Management surfaces</h3>
              </div>
              <p>
                Task history, extension/theme management, agent controls, display tooling,
                speech, security, storage, and developer logs stay as placeholders until
                their owning Phase 1 or later tasks land.
              </p>
            </section>
          </div>
        ) : (
          <section className="placeholder-card">
            <p className="eyebrow">Navigation contract ready</p>
            <h2>{section}</h2>
            <p>
              This section intentionally has no simulated management data. Its functionality
              belongs to a later task; the Phase 1 shell provides the route and layout only.
            </p>
            <button type="button" onClick={() => setSection("Overview")}>Return to Overview</button>
          </section>
        )}
      </main>
    </div>
  );
}
