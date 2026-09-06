import { useCallback, useEffect, useMemo, useState } from "react";

type EndpointState<T> =
  | { state: "loading"; data?: undefined; detail?: undefined }
  | { state: "available"; data: T; detail?: undefined }
  | { state: "unavailable"; data?: undefined; detail: string };

type RuntimeStatus = {
  status: string;
  name: string;
  environment: string;
  startedAt: string;
  uptimeSeconds: number;
  pid: number;
  nodeVersion: string;
  dataDir: string;
};

type ExtensionRecord = {
  id: string;
  enabled: boolean;
  state: string;
  requestedPermissions: string[];
  grantedPermissions: string[];
  contributions: Record<string, unknown>;
  settings: Record<string, unknown>;
  secretRefs: Array<{ id: string; required: boolean }>;
  mcp: Array<Record<string, unknown>>;
  diagnostics: Array<{ code: string; message: string }>;
};

type ExtensionRuntimeSnapshot = {
  extensions: ExtensionRecord[];
  backendDiagnostics: Array<{ code?: string; message?: string }>;
  security: { defaultGrantPolicy: string; secretValuesExposed: boolean };
};

type ThemeSnapshot = {
  packages: Array<{
    id?: string;
    version?: string;
    enabled: boolean;
    state: string;
    diagnostics?: Array<{ code?: string; message?: string }>;
  }>;
  activeTheme?: { id?: string } | null;
};

type ProviderSnapshot = {
  id: string;
  status: { available: boolean; detail?: string };
  capabilities: Record<string, boolean>;
};

type ProviderList = { providers: ProviderSnapshot[] };
type TaskList = {
  tasks: Array<{ id: string; status: string; providerId?: string }>;
};

type OperatorSection =
  | "System"
  | "Extensions"
  | "Themes"
  | "Agents & MCP"
  | "Security"
  | "Storage"
  | "Speech & Display"
  | "Developer";

const sections: OperatorSection[] = [
  "System",
  "Extensions",
  "Themes",
  "Agents & MCP",
  "Security",
  "Storage",
  "Speech & Display",
  "Developer",
];

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

function Availability({
  label,
  value,
}: {
  label: string;
  value: EndpointState<unknown>;
}) {
  return (
    <section className="metric-card">
      <span>{label}</span>
      <strong>
        {value.state === "available"
          ? "Available"
          : value.state === "loading"
            ? "Checking…"
            : "Unavailable"}
      </strong>
      <small>
        {value.state === "unavailable"
          ? value.detail
          : "Capability detected from core"}
      </small>
    </section>
  );
}

export function OperatorConsole() {
  const [section, setSection] = useState<OperatorSection>("System");
  const [runtime, setRuntime] = useState<EndpointState<RuntimeStatus>>({
    state: "loading",
  });
  const [extensions, setExtensions] = useState<
    EndpointState<ExtensionRuntimeSnapshot>
  >({ state: "loading" });
  const [themes, setThemes] = useState<EndpointState<ThemeSnapshot>>({
    state: "loading",
  });
  const [providers, setProviders] = useState<EndpointState<ProviderList>>({
    state: "loading",
  });
  const [tasks, setTasks] = useState<EndpointState<TaskList>>({
    state: "loading",
  });
  const [busyExtension, setBusyExtension] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [nextRuntime, nextExtensions, nextThemes, nextProviders, nextTasks] =
      await Promise.all([
        probe<RuntimeStatus>("/api/status"),
        probe<ExtensionRuntimeSnapshot>("/api/extensions/runtime"),
        probe<ThemeSnapshot>("/api/themes"),
        probe<ProviderList>("/api/providers"),
        probe<TaskList>("/api/tasks"),
      ]);
    setRuntime(nextRuntime);
    setExtensions(nextExtensions);
    setThemes(nextThemes);
    setProviders(nextProviders);
    setTasks(nextTasks);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleExtension = async (extension: ExtensionRecord) => {
    setBusyExtension(extension.id);
    try {
      const response = await fetch(
        `/api/extensions/${encodeURIComponent(extension.id)}/enabled`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: !extension.enabled }),
        },
      );
      if (!response.ok)
        throw new Error(`Extension update failed (${response.status})`);
      setMessage(
        `${extension.id} ${extension.enabled ? "disabled" : "enabled"}`,
      );
      setExtensions(
        await probe<ExtensionRuntimeSnapshot>("/api/extensions/runtime"),
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Extension update failed",
      );
    } finally {
      setBusyExtension(null);
    }
  };

  const enabledExtensions = useMemo(
    () =>
      extensions.state === "available"
        ? extensions.data.extensions.filter((item) => item.enabled).length
        : 0,
    [extensions],
  );

  const availableProviders = useMemo(
    () =>
      providers.state === "available"
        ? providers.data.providers.filter((item) => item.status.available)
            .length
        : 0,
    [providers],
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">T</span>
          <div>
            <strong>Totem</strong>
            <span>Operator Console</span>
          </div>
        </div>
        <nav aria-label="Operator sections">
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
          <span
            className={`connection-dot ${runtime.state === "available" ? "live" : "offline"}`}
          />
          <div>
            <strong>
              {runtime.state === "available" ? "Core live" : "Core unavailable"}
            </strong>
            <span>capability-driven UI</span>
          </div>
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Management · live core capabilities</p>
            <h1>{section}</h1>
          </div>
          <div>
            <a className="connection-pill live" href="/">
              Dashboard
            </a>{" "}
            <button
              type="button"
              className="connection-pill"
              onClick={() => void refresh()}
            >
              Refresh
            </button>
          </div>
        </header>

        {message ? <div className="notice">{message}</div> : null}

        {section === "System" ? (
          <div className="overview-grid">
            <Availability label="Core" value={runtime} />
            <Availability label="Extension runtime" value={extensions} />
            <Availability label="Theme discovery" value={themes} />
            <Availability label="Agent providers" value={providers} />
            <section className="hero-card">
              <div>
                <p className="eyebrow">Operator summary</p>
                <h2>One surface, feature-detected from core</h2>
                <p>
                  The console never invents browser-owned service state. Each
                  panel probes a real core endpoint and stays explicitly
                  unavailable until its subsystem lands.
                </p>
              </div>
              <div className="hero-status">
                <strong>{enabledExtensions} extensions</strong>
                <small>{availableProviders} providers available</small>
              </div>
            </section>
          </div>
        ) : null}

        {section === "Extensions" ? (
          <div className="overview-grid">
            {extensions.state === "available" ? (
              extensions.data.extensions.map((extension) => (
                <section className="phase-card" key={extension.id}>
                  <div>
                    <p className="eyebrow">{extension.state}</p>
                    <h3>{extension.id}</h3>
                  </div>
                  <p>
                    {extension.grantedPermissions.length}/
                    {extension.requestedPermissions.length} requested
                    permissions granted · {extension.mcp.length} MCP
                    registrations · {extension.secretRefs.length} secret
                    references
                  </p>
                  {extension.diagnostics.length > 0 ? (
                    <p>
                      {extension.diagnostics
                        .map((item) => item.message)
                        .join(" · ")}
                    </p>
                  ) : null}
                  <button
                    disabled={busyExtension === extension.id}
                    type="button"
                    onClick={() => void toggleExtension(extension)}
                  >
                    {busyExtension === extension.id
                      ? "Updating…"
                      : extension.enabled
                        ? "Disable"
                        : "Enable"}
                  </button>
                </section>
              ))
            ) : (
              <section className="placeholder-card">
                <h2>Extension runtime unavailable</h2>
                <p>
                  {extensions.state === "unavailable"
                    ? extensions.detail
                    : "Checking core…"}
                </p>
              </section>
            )}
          </div>
        ) : null}

        {section === "Themes" ? (
          <div className="overview-grid">
            {themes.state === "available" ? (
              themes.data.packages.map((theme, index) => (
                <section
                  className="phase-card"
                  key={theme.id ?? `theme-${index}`}
                >
                  <div>
                    <p className="eyebrow">{theme.state}</p>
                    <h3>{theme.id ?? "Invalid theme"}</h3>
                  </div>
                  <p>
                    Version {theme.version ?? "—"} ·{" "}
                    {theme.enabled ? "enabled" : "disabled"}
                  </p>
                </section>
              ))
            ) : (
              <section className="placeholder-card">
                <h2>Theme service unavailable</h2>
                <p>
                  {themes.state === "unavailable"
                    ? themes.detail
                    : "Checking core…"}
                </p>
              </section>
            )}
          </div>
        ) : null}

        {section === "Agents & MCP" ? (
          <div className="overview-grid">
            {providers.state === "available" ? (
              providers.data.providers.map((provider) => (
                <section className="phase-card" key={provider.id}>
                  <div>
                    <p className="eyebrow">AgentProvider</p>
                    <h3>{provider.id}</h3>
                  </div>
                  <p>
                    {provider.status.available ? "Available" : "Unavailable"} ·{" "}
                    {provider.status.detail ?? "No additional detail"}
                  </p>
                  <p>
                    {Object.entries(provider.capabilities)
                      .filter(([, enabled]) => enabled)
                      .map(([name]) => name)
                      .join(" · ") || "No advertised capabilities"}
                  </p>
                </section>
              ))
            ) : (
              <section className="placeholder-card">
                <h2>Provider service unavailable</h2>
                <p>
                  {providers.state === "unavailable"
                    ? providers.detail
                    : "Checking core…"}
                </p>
              </section>
            )}
            {extensions.state === "available" ? (
              <section className="phase-card muted-card">
                <div>
                  <p className="eyebrow">Extension MCP registrations</p>
                  <h3>
                    {extensions.data.extensions.reduce(
                      (sum, item) => sum + item.mcp.length,
                      0,
                    )}
                  </h3>
                </div>
                <p>
                  Registrations are reported by the permission-gated extension
                  runtime. Secret values are never returned here.
                </p>
              </section>
            ) : null}
          </div>
        ) : null}

        {section === "Security" ? (
          <div className="overview-grid">
            {extensions.state === "available" ? (
              <>
                <section className="metric-card">
                  <span>Default extension grant</span>
                  <strong>{extensions.data.security.defaultGrantPolicy}</strong>
                  <small>Fail-closed permission policy</small>
                </section>
                <section className="metric-card">
                  <span>Secret values exposed</span>
                  <strong>
                    {String(extensions.data.security.secretValuesExposed)}
                  </strong>
                  <small>
                    Normal runtime snapshots never include secret values
                  </small>
                </section>
                {extensions.data.extensions.map((extension) => (
                  <section className="phase-card" key={extension.id}>
                    <div>
                      <p className="eyebrow">Permission audit</p>
                      <h3>{extension.id}</h3>
                    </div>
                    <p>
                      Requested:{" "}
                      {extension.requestedPermissions.join(", ") || "none"}
                    </p>
                    <p>
                      Granted:{" "}
                      {extension.grantedPermissions.join(", ") || "none"}
                    </p>
                  </section>
                ))}
              </>
            ) : (
              <section className="placeholder-card">
                <h2>Security runtime unavailable</h2>
                <p>
                  {extensions.state === "unavailable"
                    ? extensions.detail
                    : "Checking core…"}
                </p>
              </section>
            )}
          </div>
        ) : null}

        {section === "Storage" ? (
          <div className="overview-grid">
            {runtime.state === "available" ? (
              <>
                <section className="hero-card">
                  <div>
                    <p className="eyebrow">Durable data root</p>
                    <h2 className="path-value">{runtime.data.dataDir}</h2>
                    <p>
                      Core owns storage. The dashboard only reports the
                      configured durable location.
                    </p>
                  </div>
                </section>
                <Availability label="Durable task store" value={tasks} />
                <section className="metric-card">
                  <span>Persisted tasks</span>
                  <strong>
                    {tasks.state === "available"
                      ? tasks.data.tasks.length
                      : "—"}
                  </strong>
                  <small>Read from core, not browser memory</small>
                </section>
              </>
            ) : (
              <section className="placeholder-card">
                <h2>Storage status unavailable</h2>
                <p>Core status is unavailable.</p>
              </section>
            )}
          </div>
        ) : null}

        {section === "Speech & Display" ? (
          <div className="overview-grid">
            <section className="phase-card">
              <div>
                <p className="eyebrow">Display</p>
                <h3>Simulator is a separate live surface</h3>
              </div>
              <p>
                Display state continues to arrive through normalized core
                events. Dedicated management endpoints will light up here when
                exposed.
              </p>
              <a href="http://127.0.0.1:5174">Open display simulator</a>
            </section>
            <section className="phase-card muted-card">
              <div>
                <p className="eyebrow">Speech</p>
                <h3>Capability not yet exposed by core</h3>
              </div>
              <p>
                No fake microphone, STT, TTS, or model state is shown. This
                remains honestly unavailable until the speech runtime publishes
                a management API.
              </p>
            </section>
          </div>
        ) : null}

        {section === "Developer" ? (
          <div className="overview-grid">
            {runtime.state === "available" ? (
              <>
                <section className="metric-card">
                  <span>Node</span>
                  <strong>{runtime.data.nodeVersion}</strong>
                  <small>PID {runtime.data.pid}</small>
                </section>
                <section className="metric-card">
                  <span>Environment</span>
                  <strong>{runtime.data.environment}</strong>
                  <small>
                    Started {new Date(runtime.data.startedAt).toLocaleString()}
                  </small>
                </section>
              </>
            ) : null}
            <section className="phase-card muted-card">
              <div>
                <p className="eyebrow">API capability probes</p>
                <h3>Live endpoint matrix</h3>
              </div>
              <p>
                Core: {runtime.state} · Extensions: {extensions.state} · Themes:{" "}
                {themes.state} · Providers: {providers.state} · Tasks:{" "}
                {tasks.state}
              </p>
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}
