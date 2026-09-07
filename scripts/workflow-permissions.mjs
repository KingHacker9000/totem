import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ALLOWED = new Map([["contents", "read"]]);

export function inspectWorkflowPermissions(text, file = "<workflow>") {
  const lines = text.split(/\r?\n/);
  const failures = [];
  let declarationLine = null;
  let permissions = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/^permissions:\s*(?:#.*)?$/.test(line)) continue;
    if (declarationLine !== null) {
      failures.push(
        `${file}:${index + 1}: duplicate top-level permissions declaration`,
      );
      continue;
    }
    declarationLine = index + 1;
    permissions = new Map();
    for (let child = index + 1; child < lines.length; child += 1) {
      const raw = lines[child];
      if (!raw.trim() || /^\s*#/.test(raw)) continue;
      if (!/^\s/.test(raw)) break;
      const match = raw.match(
        /^\s{2}([a-z-]+):\s*(read|write|none)\s*(?:#.*)?$/,
      );
      if (!match) {
        failures.push(
          `${file}:${child + 1}: unsupported permissions syntax; use explicit two-space scope: read|none entries`,
        );
        continue;
      }
      const [, scope, access] = match;
      if (permissions.has(scope)) {
        failures.push(
          `${file}:${child + 1}: duplicate permission scope: ${scope}`,
        );
      }
      permissions.set(scope, access);
    }
  }

  if (declarationLine === null) {
    failures.push(
      `${file}:1: missing top-level permissions declaration; expected contents: read`,
    );
    return { declarationLine, permissions: {}, failures };
  }

  for (const [scope, access] of permissions) {
    const expected = ALLOWED.get(scope);
    if (expected === undefined) {
      failures.push(
        `${file}:${declarationLine}: permission scope ${scope}: ${access} is not allowed by the public CI policy`,
      );
    } else if (access !== expected) {
      failures.push(
        `${file}:${declarationLine}: permission ${scope}: ${access} exceeds/violates required ${expected}`,
      );
    }
  }
  for (const [scope, expected] of ALLOWED) {
    if (!permissions.has(scope)) {
      failures.push(
        `${file}:${declarationLine}: missing required permission ${scope}: ${expected}`,
      );
    }
  }

  return {
    declarationLine,
    permissions: Object.fromEntries(permissions),
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
  for (const file of files) {
    const relativeFile = relative(absoluteRoot, file);
    const inspected = inspectWorkflowPermissions(
      readFileSync(file, "utf8"),
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
    schema: "totem.workflow-permissions/v1",
    policy: { contents: "read" },
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
      `workflow permissions: ${summary.overall} (${workflowCount} workflows, ${failureCount} failures)`,
    );
  }
  return failureCount === 0 ? 0 : 1;
}

const isEntryPoint =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) process.exitCode = main();
