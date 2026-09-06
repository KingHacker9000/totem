import { useCallback, useEffect, useState } from "react";

type EndpointState<T> =
  | { state: "loading" }
  | { state: "available"; data: T }
  | { state: "unavailable"; detail: string };

type OperatorCapabilities = {
  speech: { statusEndpoint: string; consolePath: string; source: string };
  display: { transport: string; eventEndpoint: string; simulatorUrl: string };
  security: {
    host: string;
    loopbackOnly: boolean;
    applicationAuth: string;
    externalAccessLayer: string | null;
    remoteExposureSecure: boolean;
    recommendation: string | null;
  };
  backup: { directory: string; restoreMode: string };
};

type OperatorLog = {
  occurredAt: string;
  method: string;
  url: string;
  statusCode: number;
};

type Backup = {
  schema: string;
  id: string;
  createdAt: string;
  source: string;
  entries: string[];
};

type SpeechStatus = Record<string, unknown>;

async function probe<T>(path: string): Promise<EndpointState<T>> {
  try {
    const response = await fetch(path, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return {
        state: "unavailable",
        detail: `${path} returned HTTP ${response.status}`,
      };
    }
    return { state: "available", data: (await response.json()) as T };
  } catch (error) {
    return {
      state: "unavailable",
      detail:
        error instanceof Error ? error.message : `Unable to reach ${path}`,
    };
  }
}

export function ManagementConsole() {
  const [capabilities, setCapabilities] = useState<
    EndpointState<OperatorCapabilities>
  >({ state: "loading" });
  const [logs, setLogs] = useState<EndpointState<{ logs: OperatorLog[] }>>({
    state: "loading",
  });
  const [backups, setBackups] = useState<EndpointState<{ backups: Backup[] }>>({
    state: "loading",
  });
  const [speech, setSpeech] = useState<EndpointState<SpeechStatus>>({
    state: "loading",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [nextCapabilities, nextLogs, nextBackups, nextSpeech] =
      await Promise.all([
        probe<OperatorCapabilities>("/api/operator/capabilities"),
        probe<{ logs: OperatorLog[] }>("/api/operator/logs?limit=40"),
        probe<{ backups: Backup[] }>("/api/operator/backups"),
        probe<SpeechStatus>("/api/speech/status"),
      ]);
    setCapabilities(nextCapabilities);
    setLogs(nextLogs);
    setBackups(nextBackups);
    setSpeech(nextSpeech);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createBackup = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/operator/backups", { method: "POST" });
      if (!response.ok) {
        throw new Error(`Backup request returned HTTP ${response.status}`);
      }
      const payload = (await response.json()) as { backup: Backup };
      setMessage(`Backup ${payload.backup.id} created.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Backup failed");
    } finally {
      setBusy(false);
    }
  };

  const showRestorePlan = async (backup: Backup) => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/operator/backups/${encodeURIComponent(backup.id)}/restore-plan`,
        { method: "POST" },
      );
      if (!response.ok) {
        throw new Error(`Restore plan returned HTTP ${response.status}`);
      }
      const payload = (await response.json()) as {
        plan: { steps: string[] };
      };
      setMessage(payload.plan.steps.join(" → "));
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Restore plan failed",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">T</span>
          <div>
            <strong>Totem</strong>
            <span>Operator Management</span>
          </div>
        </div>
        <nav aria-label="Operator navigation">
          <a className="nav-item active" href="#security">
            Security
          </a>
          <a className="nav-item" href="#speech-display">
            Speech & Display
          </a>
          <a className="nav-item" href="#storage">
            Storage & Backup
          </a>
          <a className="nav-item" href="#logs">
            Logs
          </a>
          <a className="nav-item" href="/operator-classic">
            Classic console
          </a>
        </nav>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Core-owned management state</p>
            <h1>Operator APIs</h1>
          </div>
          <div>
            <a className="connection-pill live" href="/">
              Dashboard
            </a>{" "}
            <button
              className="connection-pill"
              onClick={() => void refresh()}
              type="button"
            >
              Refresh
            </button>
          </div>
        </header>

        {message ? <div className="notice">{message}</div> : null}

        <section id="security" className="overview-grid">
          {capabilities.state === "available" ? (
            <>
              <section className="metric-card">
                <span>Core bind</span>
                <strong>{capabilities.data.security.host}</strong>
                <small>
                  {capabilities.data.security.loopbackOnly
                    ? "Loopback only"
                    : "Remote-capable bind"}
                </small>
              </section>
              <section className="metric-card">
                <span>Remote exposure</span>
                <strong>
                  {capabilities.data.security.remoteExposureSecure
                    ? "Secure default"
                    : "Needs authenticated edge"}
                </strong>
                <small>
                  {capabilities.data.security.recommendation ??
                    "Core is bound to loopback."}
                </small>
              </section>
              <section className="phase-card">
                <div>
                  <p className="eyebrow">Security posture</p>
                  <h3>Application auth not fabricated</h3>
                </div>
                <p>
                  Totem defaults to loopback. Core does not yet claim an
                  application-wide authentication boundary; non-loopback binds
                  remain visibly unsafe until protected by an authenticated
                  reverse-access layer.
                </p>
                <p>
                  Declared edge:{" "}
                  {capabilities.data.security.externalAccessLayer ?? "none"}
                </p>
              </section>
            </>
          ) : (
            <section className="phase-card muted-card">
              <h3>Operator security unavailable</h3>
              <p>
                {capabilities.state === "unavailable"
                  ? capabilities.detail
                  : "Checking core…"}
              </p>
            </section>
          )}
        </section>

        <section id="speech-display" className="overview-grid">
          {speech.state === "available" ? (
            <section className="phase-card">
              <div>
                <p className="eyebrow">Speech runtime</p>
                <h3>Core speech status</h3>
              </div>
              <pre>{JSON.stringify(speech.data, null, 2)}</pre>
              <a href="/speech">Open speech console</a>
            </section>
          ) : (
            <section className="phase-card muted-card">
              <div>
                <p className="eyebrow">Speech runtime</p>
                <h3>Capability unavailable</h3>
              </div>
              <p>
                {speech.state === "unavailable"
                  ? speech.detail
                  : "Checking core…"}
              </p>
              <p>
                The management UI probes the real speech endpoint and does not
                synthesize browser state.
              </p>
            </section>
          )}
          {capabilities.state === "available" ? (
            <section className="phase-card">
              <div>
                <p className="eyebrow">Display</p>
                <h3>{capabilities.data.display.transport}</h3>
              </div>
              <p>Display events: {capabilities.data.display.eventEndpoint}</p>
              <a href={capabilities.data.display.simulatorUrl}>
                Open display simulator
              </a>
            </section>
          ) : null}
        </section>

        <section id="storage" className="overview-grid">
          {capabilities.state === "available" ? (
            <section className="hero-card">
              <div>
                <p className="eyebrow">Durable backups</p>
                <h2>{capabilities.data.backup.directory}</h2>
                <p>
                  Snapshots copy core-owned durable state. Live restore is
                  intentionally disabled; restore plans require a service
                  stop/restart.
                </p>
              </div>
              <button
                disabled={busy}
                onClick={() => void createBackup()}
                type="button"
              >
                {busy ? "Working…" : "Create backup"}
              </button>
            </section>
          ) : null}
          {backups.state === "available" ? (
            backups.data.backups.length > 0 ? (
              backups.data.backups.map((backup) => (
                <section className="phase-card" key={backup.id}>
                  <div>
                    <p className="eyebrow">
                      {new Date(backup.createdAt).toLocaleString()}
                    </p>
                    <h3>{backup.id}</h3>
                  </div>
                  <p>
                    {backup.entries.length} top-level state entries · source{" "}
                    {backup.source}
                  </p>
                  <button
                    disabled={busy}
                    onClick={() => void showRestorePlan(backup)}
                    type="button"
                  >
                    Show safe restore plan
                  </button>
                </section>
              ))
            ) : (
              <section className="phase-card muted-card">
                <h3>No backups yet</h3>
                <p>Create one from the core-owned state directory.</p>
              </section>
            )
          ) : null}
        </section>

        <section id="logs" className="overview-grid">
          {logs.state === "available" ? (
            <section className="hero-card">
              <div>
                <p className="eyebrow">Structured recent activity</p>
                <h2>{logs.data.logs.length} recent requests</h2>
                <p>
                  Entries come from a bounded core-side operator ring buffer;
                  the browser never scrapes arbitrary log files.
                </p>
              </div>
            </section>
          ) : null}
          {logs.state === "available" ? (
            logs.data.logs.map((entry) => (
              <section
                className="phase-card"
                key={`${entry.occurredAt}-${entry.method}-${entry.url}`}
              >
                <div>
                  <p className="eyebrow">HTTP {entry.statusCode}</p>
                  <h3>
                    {entry.method} {entry.url}
                  </h3>
                </div>
                <p>{new Date(entry.occurredAt).toLocaleString()}</p>
              </section>
            ))
          ) : (
            <section className="phase-card muted-card">
              <h3>Structured logs unavailable</h3>
              <p>
                {logs.state === "unavailable" ? logs.detail : "Checking core…"}
              </p>
            </section>
          )}
        </section>
      </main>
    </div>
  );
}
