import type { ExtensionBackendHost } from "./extensionBackendHost.js";
import type {
  ExtensionLifecycleState,
  ExtensionRuntime,
} from "./extensionRuntime.js";

export type ExtensionContributionSurface = "display" | "dashboard";

export interface ExtensionContributionView {
  extensionId: string;
  contributionId: string;
  surface: ExtensionContributionSurface;
  title: string;
  state: ExtensionLifecycleState;
  data?: unknown;
}

export interface ExtensionContributionSnapshot {
  display: ExtensionContributionView[];
  dashboard: ExtensionContributionView[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function declarations(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function titleOf(entry: Record<string, unknown>, contributionId: string): string {
  return typeof entry.title === "string" && entry.title.trim() !== ""
    ? entry.title
    : contributionId;
}

function contributionIdOf(entry: Record<string, unknown>): string | undefined {
  return typeof entry.id === "string" && entry.id.trim() !== ""
    ? entry.id
    : undefined;
}

/**
 * Convert extension-owned contribution declarations into a UI-safe snapshot.
 *
 * Dashboard declarations are unprivileged metadata. Display declarations are
 * omitted unless the extension has an effective `display.present` grant. Only
 * enabled/non-failed extensions are surfaced, so disabling or isolating a
 * failed backend removes its UI immediately on the next refresh.
 */
export async function buildExtensionContributionSnapshot(
  runtime: ExtensionRuntime,
  backendHost?: Pick<ExtensionBackendHost, "contributionSnapshot">,
): Promise<ExtensionContributionSnapshot> {
  const snapshot: ExtensionContributionSnapshot = {
    display: [],
    dashboard: [],
  };

  for (const extension of runtime.publicSnapshot()) {
    if (!extension.enabled || extension.state === "failed") continue;

    const dashboard = declarations(extension.contributions.dashboard);
    const display = extension.grantedPermissions.includes("display.present")
      ? declarations(extension.contributions.display)
      : [];

    if (dashboard.length === 0 && display.length === 0) continue;

    const data = await backendHost?.contributionSnapshot(extension.id);
    const state = runtime.get(extension.id)?.state ?? extension.state;
    if (state === "failed") continue;

    for (const entry of dashboard) {
      const contributionId = contributionIdOf(entry);
      if (!contributionId) continue;
      snapshot.dashboard.push({
        extensionId: extension.id,
        contributionId,
        surface: "dashboard",
        title: titleOf(entry, contributionId),
        state,
        ...(data === undefined ? {} : { data: structuredClone(data) }),
      });
    }

    for (const entry of display) {
      const contributionId = contributionIdOf(entry);
      if (!contributionId) continue;
      snapshot.display.push({
        extensionId: extension.id,
        contributionId,
        surface: "display",
        title: titleOf(entry, contributionId),
        state,
        ...(data === undefined ? {} : { data: structuredClone(data) }),
      });
    }
  }

  return snapshot;
}
