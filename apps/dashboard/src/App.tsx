import { useCallback, useEffect, useMemo, useState } from "react";

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

type TaskStatus =
  | "queued"
  | "running"
  | "waiting_for_input"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled";

type TaskRecord = {
  id: string;
  kind: string;
  status: TaskStatus;
  title?: string;
  sessionId?: string;
  providerId?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  failure?: { code: string; message: string; retryable: boolean };
  result?: unknown;
};

type StoredTaskEvent = {
  taskSequence: number;
  event: {
    id: string;
    type: string;
    source: string;
    occurredAt: string;
    data: unknown;
  };
};

type TaskDetail = {
  task: TaskRecord;
  events: StoredTaskEvent[];
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

function formatTimestamp(value: string | undefined) {
  return value ? new Date(value).toLocaleString() : "—";
}

function formatEventData(data: unknown) {
  if (data === null || data === undefined) return "—";
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

export function App() {
  const [section, setSection] = useState<Section>("Overview");
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;

    const loadInitialStatus = async () => {
      try {
        const response = await fetch("/api/status", {
          headers: { accept: "application/json" },
        });
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
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to reach Totem core",
          );
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
        const event = JSON.parse(
          (message as MessageEvent<string>).data,
        ) as CoreStatusEvent;
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
        setConnection((current) =>
          current === "live" ? "reconnecting" : "offline",
        );
        setError("Live event stream interrupted; retrying automatically.");
      }
    };

    return () => {
      disposed = true;
      source.close();
    };
  }, []);

  const loadTasks = useCallback(async () => {
    setTasksLoading(true);
    try {
      const response = await fetch("/api/tasks", {
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Task list request failed (${response.status})`);
      }
      const payload = (await response.json()) as { tasks: TaskRecord[] };
      setTasks(payload.tasks);
      setSelectedTaskId((current) => {
        if (current && payload.tasks.some((task) => task.id === current)) {
          return current;
        }
        return payload.tasks[0]?.id ?? null;
      });
      setTaskError(null);
    } catch (cause) {
      setTaskError(
        cause instanceof Error ? cause.message : "Unable to load durable tasks",
      );
    } finally {
      setTasksLoading(false);
    }
  }, []);

  const loadTaskDetail = useCallback(async (taskId: string) => {
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Task detail request failed (${response.status})`);
      }
      setTaskDetail((await response.json()) as TaskDetail);
      setTaskError(null);
    } catch (cause) {
      setTaskDetail(null);
      setTaskError(
        cause instanceof Error
          ? cause.message
          : "Unable to load durable task history",
      );
    }
  }, []);

  useEffect(() => {
    if (section !== "Tasks") return;
    void loadTasks();
  }, [section, loadTasks]);

  useEffect(() => {
    if (section !== "Tasks" || !selectedTaskId) {
      setTaskDetail(null);
      return;
    }
    void loadTaskDetail(selectedTaskId);
  }, [section, selectedTaskId, loadTaskDetail]);

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
                <h2>
                  {runtime
                    ? `${runtime.name} is ${runtime.status}`
                    : "Connecting to Totem core"}
                </h2>
                <p>
                  This dashboard observes the local core process. Runtime state
                  comes from <code>/api/status</code> and the reconnecting{" "}
                  <code>/api/events</code> stream.
                </p>
              </div>
              <div className="hero-status">
                <span className={`pulse ${connection}`} />
                <strong>{runtime?.stage ?? "phase-1"}</strong>
                <small>
                  {lastEventAt
                    ? `Last event ${new Date(lastEventAt).toLocaleTimeString()}`
                    : "Awaiting event"}
                </small>
              </div>
            </section>

            <section className="metric-card">
              <span>Uptime</span>
              <strong>
                {runtime ? formatUptime(runtime.uptimeSeconds) : "--:--:--"}
              </strong>
              <small>Started {started}</small>
            </section>
            <section className="metric-card">
              <span>Runtime</span>
              <strong>{runtime?.nodeVersion ?? "—"}</strong>
              <small>PID {runtime?.pid ?? "—"}</small>
            </section>
            <section className="metric-card wide">
              <span>Data directory</span>
              <strong className="path-value">
                {runtime?.dataDir ?? "Waiting for core status…"}
              </strong>
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
                <li>Durable task list and history inspection</li>
              </ul>
            </section>

            <section className="phase-card muted-card">
              <div>
                <p className="eyebrow">Owned by later tasks</p>
                <h3>Remaining management surfaces</h3>
              </div>
              <p>
                Extension/theme management, agent controls, display tooling,
                speech, security, storage, and developer logs remain honest
                placeholders until their owning tasks land.
              </p>
            </section>
          </div>
        ) : section === "Tasks" ? (
          <div className="tasks-layout">
            {taskError ? <div className="notice">{taskError}</div> : null}

            <section className="task-list-card">
              <div className="task-section-heading">
                <div>
                  <p className="eyebrow">Durable core state</p>
                  <h2>Task history</h2>
                </div>
                <button type="button" onClick={() => void loadTasks()}>
                  {tasksLoading ? "Refreshing…" : "Refresh"}
                </button>
              </div>

              {tasks.length === 0 ? (
                <p className="empty-state">
                  {tasksLoading
                    ? "Loading durable tasks…"
                    : "No persisted tasks yet. Mock-provider tasks will appear here once created by core."}
                </p>
              ) : (
                <div className="task-list">
                  {tasks.map((task) => (
                    <button
                      className={
                        task.id === selectedTaskId
                          ? "task-row selected"
                          : "task-row"
                      }
                      key={task.id}
                      onClick={() => setSelectedTaskId(task.id)}
                      type="button"
                    >
                      <div>
                        <strong>{task.title ?? task.id}</strong>
                        <span>{task.kind}</span>
                      </div>
                      <div className="task-row-meta">
                        <span className={`task-status ${task.status}`}>
                          {task.status.replaceAll("_", " ")}
                        </span>
                        <small>{formatTimestamp(task.updatedAt)}</small>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="task-detail-card">
              {taskDetail ? (
                <>
                  <div className="task-detail-heading">
                    <div>
                      <p className="eyebrow">{taskDetail.task.kind}</p>
                      <h2>{taskDetail.task.title ?? taskDetail.task.id}</h2>
                    </div>
                    <span className={`task-status ${taskDetail.task.status}`}>
                      {taskDetail.task.status.replaceAll("_", " ")}
                    </span>
                  </div>

                  <dl className="task-facts">
                    <div>
                      <dt>Task ID</dt>
                      <dd>{taskDetail.task.id}</dd>
                    </div>
                    <div>
                      <dt>Provider</dt>
                      <dd>{taskDetail.task.providerId ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Created</dt>
                      <dd>{formatTimestamp(taskDetail.task.createdAt)}</dd>
                    </div>
                    <div>
                      <dt>Completed</dt>
                      <dd>{formatTimestamp(taskDetail.task.completedAt)}</dd>
                    </div>
                  </dl>

                  {taskDetail.task.failure ? (
                    <div className="task-failure">
                      <strong>{taskDetail.task.failure.code}</strong>
                      <span className="task-failure-message">
                        {taskDetail.task.failure.message}
                      </span>
                    </div>
                  ) : null}

                  <div className="task-history-heading">
                    <p className="eyebrow">Persisted event log</p>
                    <strong>{taskDetail.events.length} events</strong>
                  </div>
                  <ol className="task-history">
                    {taskDetail.events.map((entry) => (
                      <li key={`${entry.taskSequence}-${entry.event.id}`}>
                        <span className="event-sequence">
                          #{entry.taskSequence}
                        </span>
                        <div>
                          <strong>{entry.event.type}</strong>
                          <span>{formatTimestamp(entry.event.occurredAt)}</span>
                          <code>{formatEventData(entry.event.data)}</code>
                        </div>
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <p className="empty-state">
                  Select a persisted task to inspect its snapshot and
                  append-only event history.
                </p>
              )}
            </section>
          </div>
        ) : (
          <section className="placeholder-card">
            <p className="eyebrow">Navigation contract ready</p>
            <h2>{section}</h2>
            <p>
              This section intentionally has no simulated management data. Its
              functionality belongs to a later task; the Phase 1 shell provides
              the route and layout only.
            </p>
            <button type="button" onClick={() => setSection("Overview")}>
              Return to Overview
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
