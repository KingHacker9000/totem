import { createHash } from "node:crypto";
import { publishEvent } from "./event-ingress.mjs";

const UNIT = /^[A-Za-z0-9_.@-]{1,80}\.service$/;
export function jobUnits(value = "") {
  const units = [
    ...new Set(
      value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
  if (units.length > 8 || units.some((unit) => !UNIT.test(unit)))
    throw new Error("invalid monitored job units");
  return units;
}
export function observeJobs(companion, reports, boot) {
  companion.state.jobRuns ||= {};
  const cursors = companion.state.jobRuns;
  for (const report of reports) {
    const unit = report.Id;
    const end = Number(report.ExecMainExitTimestampMonotonic);
    const start = Number(report.ExecMainStartTimestampMonotonic);
    if (
      !UNIT.test(unit || "") ||
      report.LoadState !== "loaded" ||
      report.Type !== "oneshot" ||
      !Number.isFinite(end) ||
      !Number.isFinite(start) ||
      end <= 0 ||
      end < start ||
      !["inactive", "failed"].includes(report.ActiveState)
    )
      continue;
    const failed =
      report.Result !== "success" || Number(report.ExecMainStatus) !== 0;
    const previous = cursors[unit];
    // Initial configuration/new boot records a baseline, not old completion notifications.
    const baseline = !previous || previous.boot !== boot;
    if (baseline && !failed) {
      cursors[unit] = { boot, end, failed };
      continue;
    }
    if (!baseline && end <= previous.end) continue;
    const previouslyFailed = !baseline && previous.failed;
    const routine = !failed && !previouslyFailed;
    const key = createHash("sha256")
      .update(`${boot}:${unit}:${end}`)
      .digest("hex")
      .slice(0, 32);
    const label = unit
      .replace(/\.service$/, "")
      .replace(/[-_.]/g, " ")
      .slice(0, 60);
    const result = publishEvent(companion, {
      source: "jobs",
      type: failed
        ? "job.failed"
        : previouslyFailed
          ? "job.recovered"
          : "job.completed",
      title: `${label} ${failed ? "failed" : previouslyFailed ? "recovered" : "completed"}`,
      detail: failed
        ? `Background job result: ${String(report.Result).slice(0, 40)}; exit ${Number(report.ExecMainStatus)}.`
        : "Background job finished successfully.",
      severity: failed ? "urgent" : routine ? "info" : "attention",
      ttlSeconds: failed ? 600 : 60,
      proactive: !routine,
      dedupeKey: `job:${key}`,
    });
    if (result.ok) cursors[unit] = { boot, end, failed };
  }
}
