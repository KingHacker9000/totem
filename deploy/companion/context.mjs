import { checkObject, text } from "./state.mjs";

const clip = (value, limit = 300) =>
  typeof value === "string" ? value.slice(0, limit) : value;
const fields = (value, keys) =>
  Object.fromEntries(
    keys
      .filter((key) => value?.[key] !== undefined)
      .map((key) => [key, clip(value[key])]),
  );
export function context(nav, state) {
  return {
    updatedAt: nav.updatedAt || null,
    ...state,
    events: (state.events || []).slice(0, 32),
    approvals: (state.approvals || []).slice(0, 16),
    connectors: (nav.catalog || [])
      .slice(0, 32)
      .map((c) =>
        fields(c, [
          "id",
          "name",
          "implemented",
          "enabled",
          "health",
          "status",
          "detail",
          "lastSyncAt",
          "app",
        ]),
      ),
    apps: (nav.apps || []).slice(0, 16).map((app) => ({
      ...fields(app, [
        "id",
        "connectorId",
        "title",
        "subtitle",
        "status",
        "updatedAt",
      ]),
      data: {
        ...fields(app.data, [
          "headline",
          "headlineLabel",
          "ranking",
          "updatedAt",
        ]),
        rows: (app.data?.rows || [])
          .slice(0, 32)
          .map((row) => fields(row, ["label", "value", "detail"])),
        portfolios: (app.data?.portfolios || [])
          .slice(0, 8)
          .map((p) =>
            fields(p, [
              "id",
              "name",
              "currentValue",
              "todayChangePct",
              "sinceInceptionChangePct",
              "updatedAt",
            ]),
          ),
      },
    })),
    widgets: (nav.widgets || []).slice(0, 32).map((w) => ({
      ...fields(w, [
        "id",
        "connectorId",
        "name",
        "health",
        "title",
        "primary",
        "secondary",
        "status",
        "updatedAt",
      ]),
      data: {
        ...fields(w.data, [
          "nextDueAt",
          "nextCourse",
          "nextName",
          "startAt",
          "start",
          "end",
          "location",
          "repository",
          "reason",
          "high",
          "low",
          "temperature",
          "units",
          "conditionKey",
          "isDay",
          "ranking",
          "updatedAt",
        ]),
        ...(Array.isArray(w.data?.topPortfolios)
          ? {
              topPortfolios: w.data.topPortfolios
                .slice(0, 8)
                .map((p) =>
                  fields(p, [
                    "id",
                    "name",
                    "currentValue",
                    "todayChangePct",
                    "sinceInceptionChangePct",
                    "updatedAt",
                  ]),
                ),
            }
          : {}),
      },
    })),
  };
}

export function displayTarget(args, nav) {
  checkObject(args, ["target"]);
  const target = text(args.target, 96);
  if (["home", "launcher"].includes(target)) return target;
  if (
    (nav.catalog || []).some(
      (c) => c.id === target && c.enabled && c.implemented && c.app,
    )
  )
    return target;
  if (
    (nav.widgets || []).some(
      (w) =>
        w.id === target &&
        (nav.catalog || []).some(
          (c) => c.id === w.connectorId && c.enabled && c.implemented,
        ),
    )
  )
    return target;
  throw new Error(
    "unknown or disabled display target; read totem.context for available apps/widgets",
  );
}
