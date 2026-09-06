import { useCallback, useEffect, useState } from "react";

type ContributionView = {
  extensionId: string;
  contributionId: string;
  surface: "display" | "dashboard";
  title: string;
  state: string;
  data?: unknown;
};

type ContributionSnapshot = {
  dashboard: ContributionView[];
  display: ContributionView[];
  security: {
    displayRequiresGrant: string;
    disabledAndFailedExtensionsVisible: boolean;
  };
};

function labelFor(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    if (value.length === 0) return "None";
    return value
      .map((item) =>
        typeof item === "object" && item !== null
          ? JSON.stringify(item)
          : String(item),
      )
      .join(" · ");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function ContributionCard({ view }: { view: ContributionView }) {
  const fields =
    typeof view.data === "object" && view.data !== null && !Array.isArray(view.data)
      ? Object.entries(view.data as Record<string, unknown>)
      : [["value", view.data] as const];

  return (
    <section className="phase-card contribution-card">
      <div>
        <p className="eyebrow">
          {view.extensionId} · {view.state}
        </p>
        <h3>{view.title}</h3>
      </div>
      {view.data === undefined ? (
        <p className="muted">No presentation snapshot is currently available.</p>
      ) : (
        <dl className="contribution-fields">
          {fields.map(([key, value]) => (
            <div key={key}>
              <dt>{labelFor(key)}</dt>
              <dd>{renderValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export function ContributionConsole() {
  const [snapshot, setSnapshot] = useState<ContributionSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/extensions/contributions", {
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Contribution request failed (${response.status})`);
      }
      setSnapshot((await response.json()) as ContributionSnapshot);
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load extension contributions",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <main className="content contribution-console">
      <header className="topbar">
        <div>
          <p className="eyebrow">Extension platform · generic UI host</p>
          <h1>Extension contributions</h1>
        </div>
        <div>
          <a className="connection-pill" href="/operator">
            Operator
          </a>{" "}
          <button className="connection-pill" type="button" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
      </header>

      {error ? <div className="notice">{error}</div> : null}

      <section className="hero-card">
        <div>
          <p className="eyebrow">Dashboard surface</p>
          <h2>Mounted from extension-owned declarations</h2>
          <p>
            Cards below are discovered from the generic contribution API. This
            host contains no extension-id switch and removes owners when core
            reports them disabled or failed.
          </p>
        </div>
        <div className="hero-status">
          <strong>{snapshot?.dashboard.length ?? 0} dashboard views</strong>
          <small>{snapshot?.display.length ?? 0} display views granted</small>
        </div>
      </section>

      {loading ? <p>Loading extension contributions…</p> : null}
      {!loading && snapshot?.dashboard.length === 0 ? (
        <section className="phase-card muted-card">
          <div>
            <p className="eyebrow">No dashboard contributions</p>
            <h3>Nothing is currently mounted</h3>
          </div>
          <p>Enable a compatible extension with a dashboard contribution.</p>
        </section>
      ) : null}

      <div className="overview-grid contribution-grid">
        {snapshot?.dashboard.map((view) => (
          <ContributionCard
            key={`${view.extensionId}:${view.contributionId}`}
            view={view}
          />
        ))}
      </div>

      <section className="phase-card muted-card">
        <div>
          <p className="eyebrow">Display authority</p>
          <h3>Fail-closed presentation grants</h3>
        </div>
        <p>
          Display contributions appear only with an effective <code>display.present</code>{" "}
          grant. The simulator consumes the same API and safe-area contract.
        </p>
      </section>
    </main>
  );
}
