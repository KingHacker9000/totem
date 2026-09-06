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

type ThemeRuntimeSnapshot = {
  theme: {
    activeThemeId: string | null;
    previousThemeId?: string;
    source: string;
    packagePath: string | null;
    manifest: {
      id: string;
      name: string;
      version: string;
      voice?: {
        provider?: string;
        model?: string;
        voice?: string;
        rate?: number;
        pitch?: number;
      };
    } | null;
  };
  installed: Array<{
    id: string;
    name: string;
    version: string;
    active: boolean;
  }>;
  security: { privilegeBearing: boolean; secretValuesExposed: boolean };
};

type ProviderSnapshot = {
  id: string;
  status: { available: boolean; detail?: string };
  capabilities: Record<string, boolean>;
};

type ProviderList = { providers: ProviderSnapshot[] };
type TaskRecord = {
  id: string;
  status: string;
  providerId?: string;
  prompt?: string;
};
type TaskList = { tasks: TaskRecord[] };

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

async function mutate(path: string, init: RequestInit): Promise<void> {
  const response = await fetch(path, {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
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

function UnavailableCapability({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <section className="phase-card muted-card">
      <div>
        <p className="eyebrow">Not exposed by core</p>
        <h3>{title}</h3>
      </div>
      <p>{detail}</p>
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
  const [themeRuntime, setThemeRuntime] = useState<
    EndpointState<ThemeRuntimeSnapshot>
  >({ state: "loading" });
  const [providers, setProviders] = useState<EndpointState<ProviderList>>({
    state: "loading",
  });
  const [tasks, setTasks] = useState<EndpointState<TaskList>>({
    state: "loading",
  });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [
      nextRuntime,
      nextExtensions,
      nextThemes,
      nextThemeRuntime,
      nextProviders,
      nextTasks,
    ] = await Promise.all([
      probe<RuntimeStatus>("/api/status"),
      probe<ExtensionRuntimeSnapshot>("/api/extensions/runtime"),
      probe<ThemeSnapshot>("/api/themes"),
      probe<ThemeRuntimeSnapshot>("/api/themes/runtime"),
      probe<ProviderList>("/api/providers"),
      probe<TaskList>("/api/tasks"),
    ]);
    setRuntime(nextRuntime);
    setExtensions(nextExtensions);
    setThemes(nextThemes);
    setThemeRuntime(nextThemeRuntime);
    setProviders(nextProviders);
    setTasks(nextTasks);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runMutation = async (
    key: string,
    success: string,
    action: () => Promise<void>,
  ) => {
    setBusyKey(key);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Operation failed");
    } finally {
      setBusyKey(null);
    }
  };

  const toggleExtension = async (extension: ExtensionRecord) => {
    await runMutation(
      `extension:${extension.id}`,
      `${extension.id} ${extension.enabled ? "disabled" : "enabled"}`,
      () =>
        mutate(`/api/extensions/${encodeURIComponent(extension.id)}/enabled`, {
          method: "PUT",
          body: JSON.stringify({ enabled: !extension.enabled }),
        }),
    );
  };

  const editSetting = async (
    extension: ExtensionRecord,
    key: string,
    currentValue: unknown,
  ) => {
    const next = window.prompt(
      `Set ${extension.id}.${key} as JSON or plain text`,
      JSON.stringify(currentValue),
    );
    if (next === null) return;
    let value: unknown = next;
    try {
      value = JSON.parse(next) as unknown;
    } catch {
      value = next;
    }
    await runMutation(
      `setting:${extension.id}:${key}`,
      `${extension.id}.${key} updated`,
      () =>
        mutate(
          `/api/extensions/${encodeURIComponent(extension.id)}/settings/${encodeURIComponent(key)}`,
          { method: "PUT", body: JSON.stringify({ value }) },
        ),
    );
  };

  const activateTheme = async (themeId: string) => {
    await runMutation(`theme:${themeId}`, `${themeId} activated`, () =>
      mutate("/api/themes/active", {
        method: "PUT",
        body: JSON.stringify({ themeId }),
      }),
    );
  };

  const rollbackTheme = async () => {
    await runMutation("theme:rollback", "Theme rolled back", () =>
      mutate("/api/themes/rollback", { method: "POST" }),
    );
  };

  const interruptTask = async (taskId: string) => {
    await runMutation(
      `task:${taskId}`,
      `Interrupt requested for ${taskId}`,
      () =>
        mutate(`/api/tasks/${encodeURIComponent(taskId)}/interrupt`, {
          method: "POST",
        }),
    );
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

  const activeTasks = useMemo(
    () =>
      tasks.state === "available"
        ? tasks.data.tasks.filter((item) =>
            ["queued", "running", "waiting", "cancelling"].includes(
              item.status,
            ),
          )
        : [],
    [tasks],
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
            <Availability label="Theme runtime" value={themeRuntime} />
            <Availability label="Agent providers" value={providers} />
            <section className="hero-card">
              <div>
                <p className="eyebrow">Operator summary</p>
                <h2>One surface, feature-detected from core</h2>
                <p>
                  Management state is always re-read from core. Unsupported
                  subsystems remain explicit instead of being simulated in the
                  browser.
                </p>
              </div>
              <div className="hero-status">
                <strong>{enabledExtensions} extensions</strong>
                <small>
                  {availableProviders} providers · {activeTasks.length} active
                  tasks
                </small>
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
                    {extension.requestedPermissions.length} permissions granted
                    · {extension.mcp.length} MCP registrations ·{" "}
                    {extension.secretRefs.length} secret references
                  </p>
                  {Object.keys(extension.settings).length > 0 ? (
                    <div>
                      {Object.entries(extension.settings).map(
                        ([key, value]) => (
                          <p key={key}>
                            <strong>{key}:</strong> {JSON.stringify(value)}{" "}
                            <button
                              disabled={
                                busyKey === `setting:${extension.id}:${key}`
                              }
                              onClick={() =>
                                void editSetting(extension, key, value)
                              }
                              type="button"
                            >
                              Edit
                            </button>
                          </p>
                        ),
                      )}
                    </div>
                  ) : (
                    <p>No extension settings are currently declared.</p>
                  )}
                  {extension.diagnostics.length > 0 ? (
                    <p>
                      {extension.diagnostics
                        .map((item) => item.message)
                        .join(" · ")}
                    </p>
                  ) : null}
                  <button
                    disabled={busyKey === `extension:${extension.id}`}
                    type="button"
                    onClick={() => void toggleExtension(extension)}
                  >
                    {busyKey === `extension:${extension.id}`
                      ? "Updating…"
                      : extension.enabled
                        ? "Disable"
                        : "Enable"}
                  </button>
                </section>
              ))
            ) : (
              <UnavailableCapability
                title="Extension runtime"
                detail={
                  extensions.state === "unavailable"
                    ? extensions.detail
                    : "Checking core…"
                }
              />
            )}
          </div>
        ) : null}

        {section === "Themes" ? (
          <div className="overview-grid">
            {themeRuntime.state === "available" ? (
              <>
                <section className="hero-card">
                  <div>
                    <p className="eyebrow">Active theme</p>
                    <h2>
                      {themeRuntime.data.theme.activeThemeId ?? "Fallback"}
                    </h2>
                    <p>
                      Source: {themeRuntime.data.theme.source} · previous:{" "}
                      {themeRuntime.data.theme.previousThemeId ?? "none"}
                    </p>
                  </div>
                  <button
                    disabled={
                      !themeRuntime.data.theme.previousThemeId ||
                      busyKey === "theme:rollback"
                    }
                    onClick={() => void rollbackTheme()}
                    type="button"
                  >
                    Roll back
                  </button>
                </section>
                {themeRuntime.data.installed.map((theme) => (
                  <section className="phase-card" key={theme.id}>
                    <div>
                      <p className="eyebrow">
                        {theme.active ? "active" : "installed"}
                      </p>
                      <h3>{theme.name}</h3>
                    </div>
                    <p>
                      {theme.id} · version {theme.version}
                    </p>
                    <button
                      disabled={theme.active || busyKey === `theme:${theme.id}`}
                      onClick={() => void activateTheme(theme.id)}
                      type="button"
                    >
                      {theme.active ? "Active" : "Activate"}
                    </button>
                  </section>
                ))}
              </>
            ) : themes.state === "available" ? (
              themes.data.packages.map((theme, index) => (
                <section
                  className="phase-card"
                  key={theme.id ?? `theme-${index}`}
                >
                  <div>
                    <p className="eyebrow">{theme.state}</p>
                    <h3>{theme.id ?? "Invalid theme"}</h3>
                  </div>
                  <p>Runtime management endpoint is unavailable.</p>
                </section>
              ))
            ) : (
              <UnavailableCapability
                title="Theme management"
                detail={
                  themeRuntime.state === "unavailable"
                    ? themeRuntime.detail
                    : "Checking core…"
                }
              />
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
              <UnavailableCapability
                title="Agent provider service"
                detail={
                  providers.state === "unavailable"
                    ? providers.detail
                    : "Checking core…"
                }
              />
            )}
            {tasks.state === "available" ? (
              activeTasks.length > 0 ? (
                activeTasks.map((task) => (
                  <section className="phase-card" key={task.id}>
                    <div>
                      <p className="eyebrow">{task.status}</p>
                      <h3>{task.id}</h3>
                    </div>
                    <p>Provider: {task.providerId ?? "default/mock"}</p>
                    <button
                      disabled={
                        task.status === "cancelling" ||
                        busyKey === `task:${task.id}`
                      }
                      onClick={() => void interruptTask(task.id)}
                      type="button"
                    >
                      Interrupt
                    </button>
                  </section>
                ))
              ) : (
                <section className="phase-card muted-card">
                  <div>
                    <p className="eyebrow">Task activity</p>
                    <h3>No active tasks</h3>
                  </div>
                  <p>Task state is read from durable core storage.</p>
                </section>
              )
            ) : null}
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
                  Registrations come from the permission-gated runtime. Secret
                  values are never returned here.
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
                  <small>Normal runtime snapshots never include values</small>
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
              <UnavailableCapability
                title="Security runtime"
                detail={
                  extensions.state === "unavailable"
                    ? extensions.detail
                    : "Checking core…"
                }
              />
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
                    <p>Core owns storage; this path is reported live.</p>
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
                <UnavailableCapability
                  title="Backup and restore"
                  detail="No backup management API is exposed by core yet; the console does not fabricate backup state."
                />
                <UnavailableCapability
                  title="Structured logs"
                  detail="No operator log-query endpoint is exposed by core yet. Runtime diagnostics remain available through subsystem snapshots."
                />
              </>
            ) : (
              <UnavailableCapability
                title="Storage status"
                detail="Core status is unavailable."
              />
            )}
          </div>
        ) : null}

        {section === "Speech & Display" ? (
          <div className="overview-grid">
            {themeRuntime.state === "available" &&
            themeRuntime.data.theme.manifest?.voice ? (
              <section className="phase-card">
                <div>
                  <p className="eyebrow">Theme voice configuration</p>
                  <h3>
                    {themeRuntime.data.theme.manifest.voice.voice ??
                      "Theme-selected voice"}
                  </h3>
                </div>
                <p>
                  Provider{" "}
                  {themeRuntime.data.theme.manifest.voice.provider ?? "—"}
                  {" · "}model{" "}
                  {themeRuntime.data.theme.manifest.voice.model ?? "—"}
                </p>
              </section>
            ) : null}
            <UnavailableCapability
              title="Speech runtime controls"
              detail="No microphone, VAD, STT, TTS, playback, or model-management API is exposed by core yet."
            />
            <section className="phase-card">
              <div>
                <p className="eyebrow">Display</p>
                <h3>Simulator surface</h3>
              </div>
              <p>
                Display state arrives through normalized core events. Dedicated
                display settings remain unavailable until core exposes them.
              </p>
              <a href="http://127.0.0.1:5174">Open display simulator</a>
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
                Core: {runtime.state} · Extensions: {extensions.state} · Theme
                discovery: {themes.state} · Theme runtime: {themeRuntime.state}{" "}
                · Providers: {providers.state} · Tasks: {tasks.state}
              </p>
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}
