import { useCallback, useEffect, useMemo, useState } from "react";

type ProviderSnapshot = {
  id: string;
  status: { id: string; available: boolean; detail?: string };
  capabilities: {
    streaming: boolean;
    resume: boolean;
    interrupt: boolean;
    workspaces: boolean;
    mcp: boolean;
  };
};

type StartedTask = {
  taskId: string;
  sessionId: string;
  providerId: string;
  status: string;
};

export function ProviderConsole() {
  const [providers, setProviders] = useState<ProviderSnapshot[]>([]);
  const [providerId, setProviderId] = useState("codex");
  const [prompt, setPrompt] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceAccess, setWorkspaceAccess] = useState<
    "read-only" | "read-write"
  >("read-only");
  const [started, setStarted] = useState<StartedTask | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProviders = useCallback(async () => {
    try {
      const response = await fetch("/api/providers", {
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Provider status request failed (${response.status})`);
      }
      const payload = (await response.json()) as {
        providers: ProviderSnapshot[];
      };
      setProviders(payload.providers);
      const real = payload.providers.find(
        (provider) => provider.id !== "mock" && provider.status.available,
      );
      if (real) setProviderId(real.id);
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to load providers",
      );
    }
  }, []);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const selected = useMemo(
    () => providers.find((provider) => provider.id === providerId),
    [providers, providerId],
  );

  const startTask = async () => {
    if (!prompt.trim() || providerId === "mock") return;
    setBusy(true);
    try {
      const response = await fetch("/api/provider-tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          providerId,
          ...(workspacePath.trim()
            ? {
                workspace: {
                  path: workspacePath.trim(),
                  access: workspaceAccess,
                },
              }
            : {}),
        }),
      });
      const payload = (await response.json()) as
        | StartedTask
        | { message?: string; error?: string };
      if (!response.ok) {
        throw new Error(
          "message" in payload && payload.message
            ? payload.message
            : `Provider task start failed (${response.status})`,
        );
      }
      setStarted(payload as StartedTask);
      setPrompt("");
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to start provider task",
      );
    } finally {
      setBusy(false);
    }
  };

  const interrupt = async () => {
    if (!started) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/provider-tasks/${encodeURIComponent(started.taskId)}/interrupt`,
        { method: "POST" },
      );
      if (!response.ok) {
        throw new Error(`Interrupt failed (${response.status})`);
      }
      setStarted((current) =>
        current ? { ...current, status: "interrupting" } : current,
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to interrupt task");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="content">
      <header className="topbar">
        <div>
          <p className="eyebrow">Phase 4 · provider runtime</p>
          <h1>Agent Providers</h1>
        </div>
        <a href="/" className="connection-pill live">
          Dashboard
        </a>
      </header>

      {error ? <div className="notice">{error}</div> : null}

      <div className="overview-grid">
        {providers.map((provider) => (
          <section className="metric-card" key={provider.id}>
            <span>{provider.id}</span>
            <strong>{provider.status.available ? "Available" : "Unavailable"}</strong>
            <small>{provider.status.detail ?? "No provider detail"}</small>
          </section>
        ))}

        <section className="hero-card">
          <div>
            <p className="eyebrow">Provider-selected task</p>
            <h2>Run through core orchestration</h2>
            <p>
              Real CLI execution stays behind the provider-neutral core contract.
              Workspace access is explicit and provider availability is probed by
              core before a task starts.
            </p>
          </div>
          <div className="task-start-form">
            <select
              aria-label="Agent provider"
              value={providerId}
              onChange={(event) => setProviderId(event.target.value)}
            >
              {providers
                .filter((provider) => provider.id !== "mock")
                .map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.id} {provider.status.available ? "" : "(unavailable)"}
                  </option>
                ))}
            </select>
            <input
              aria-label="Provider task prompt"
              placeholder="Prompt for Codex or Claude Code"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
            <input
              aria-label="Workspace path"
              placeholder="Optional workspace path"
              value={workspacePath}
              onChange={(event) => setWorkspacePath(event.target.value)}
            />
            <select
              aria-label="Workspace access"
              value={workspaceAccess}
              onChange={(event) =>
                setWorkspaceAccess(
                  event.target.value as "read-only" | "read-write",
                )
              }
            >
              <option value="read-only">read-only</option>
              <option value="read-write">read-write</option>
            </select>
            <button
              type="button"
              disabled={
                busy ||
                !prompt.trim() ||
                !selected ||
                !selected.status.available
              }
              onClick={() => void startTask()}
            >
              {busy ? "Working…" : `Start ${providerId} task`}
            </button>
          </div>
        </section>

        {started ? (
          <section className="phase-card">
            <div>
              <p className="eyebrow">Active provider task</p>
              <h3>{started.taskId}</h3>
            </div>
            <p>
              Provider <strong>{started.providerId}</strong> · session {started.sessionId}
              {" · "}
              status {started.status}
            </p>
            <button type="button" disabled={busy} onClick={() => void interrupt()}>
              Interrupt task
            </button>
          </section>
        ) : null}

        {selected ? (
          <section className="phase-card muted-card">
            <div>
              <p className="eyebrow">Capabilities</p>
              <h3>{selected.id}</h3>
            </div>
            <p>
              streaming {String(selected.capabilities.streaming)} · resume {String(
                selected.capabilities.resume,
              )} · interrupt {String(selected.capabilities.interrupt)} · workspaces {String(
                selected.capabilities.workspaces,
              )} · MCP {String(selected.capabilities.mcp)}
            </p>
          </section>
        ) : null}
      </div>
    </main>
  );
}
