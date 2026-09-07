import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PRIVILEGED_EVENTS = new Set([
  "pull_request_target",
  "workflow_run",
  "issue_comment",
]);

const UNTRUSTED_REF_PATTERNS = [
  /github\.event\.pull_request\.head\.(?:sha|ref)/,
  /github\.head_ref/,
  /github\.event\.workflow_run\.head_sha/,
  /github\.event\.workflow_run\.head_branch/,
];

function indentation(line) {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

export function inspectWorkflowTrust(text, file = "<workflow>") {
  const lines = text.split(/\r?\n/);
  const failures = [];
  const events = [];
  let onLine = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^on:\s*(?:#.*)?$/.test(line)) {
      if (onLine !== null) {
        failures.push(`${file}:${index + 1}: duplicate top-level on declaration`);
        continue;
      }
      onLine = index + 1;
      for (let child = index + 1; child < lines.length; child += 1) {
        const raw = lines[child];
        if (!raw.trim() || /^\s*#/.test(raw)) continue;
        if (indentation(raw) === 0) break;
        if (indentation(raw) !== 2) continue;
        const match = raw.match(/^\s{2}([A-Za-z0-9_-]+):(?:\s.*)?$/);
        if (!match) continue;
        events.push({ name: match[1], line: child + 1 });
      }
    } else if (/^on:\s*\[/.test(line) || /^on:\s*[A-Za-z]/.test(line)) {
      failures.push(
        `${file}:${index + 1}: inline workflow triggers are not allowed; use an explicit top-level event mapping`,
      );
    }
  }

  if (onLine === null) {
    failures.push(`${file}:1: missing explicit top-level workflow trigger mapping`);
  }

  for (const event of events) {
    if (PRIVILEGED_EVENTS.has(event.name)) {
      failures.push(
        `${file}:${event.line}: privileged event ${event.name} is forbidden by the public workflow trust policy`,
      );
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*secrets:\s*inherit\s*(?:#.*)?$/.test(line)) {
      failures.push(
        `${file}:${index + 1}: secrets: inherit is forbidden in public workflows`,
      );
    }

    if (/^\s*ref:\s*/.test(line)) {
      for (const pattern of UNTRUSTED_REF_PATTERNS) {
        if (pattern.test(line)) {
          failures.push(
            `${file}:${index + 1}: checkout/ref expression may select attacker-controlled PR or workflow_run code`,
          );
          break;
        }
      }
    }
  }

  return {
    triggerLine: onLine,
    events: events.map((event) => event.name),
    failures,
  };
}

export function validateRepository(root) {
  const absoluteRoot = resolve(root);
  const workflowsRoot = join(absoluteRoot, ".github", "workflows");
  if (!existsSync(workflowsRoot)) {
    return { root: absoluteRoot, workflows: 0, results: [], failures: [] };
  }
  const files = readdirSync(workflowsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => join(workflowsRoot, entry.name))
    .sort();
  const results = [];
  const failures = [];
  for (const workflow of files) {
    const relativeFile = relative(absoluteRoot, workflow);
    const inspected = inspectWorkflowTrust(
      readFileSync(workflow, "utf8"),
      relativeFile,
    );
    results.push({ file: relativeFile, ...inspected });
    failures.push(...inspected.failures);
  }
  return { root: absoluteRoot, workflows: files.length, results, failures };
}

function parseArgs(argv) {
  const repos = [];
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") {
      const value = argv[index + 1];
      if (!value) throw new Error("--repo requires a path");
      repos.push(value);
      index += 1;
    } else if (arg === "--json") json = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return { repos: repos.length ? repos : ["."], json };
}

export function main(argv = process.argv.slice(2)) {
  const { repos, json } = parseArgs(argv);
  const repositories = repos.map(validateRepository);
  const failureCount = repositories.reduce(
    (sum, repository) => sum + repository.failures.length,
    0,
  );
  const workflowCount = repositories.reduce(
    (sum, repository) => sum + repository.workflows,
    0,
  );
  const summary = {
    schema: "totem.workflow-trust/v1",
    forbidden_events: [...PRIVILEGED_EVENTS].sort(),
    repositories,
    workflow_count: workflowCount,
    failure_count: failureCount,
    overall: failureCount === 0 ? "PASS" : "FAIL",
  };
  if (json) console.log(JSON.stringify(summary, null, 2));
  else {
    for (const repository of repositories) {
      console.log(`${repository.root}: ${repository.workflows} workflows`);
      for (const failure of repository.failures)
        console.error(`  FAIL ${failure}`);
    }
    console.log(
      `workflow trust: ${summary.overall} (${workflowCount} workflows, ${failureCount} failures)`,
    );
  }
  return failureCount === 0 ? 0 : 1;
}

const isEntryPoint =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) process.exitCode = main();
