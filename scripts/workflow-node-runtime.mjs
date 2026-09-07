import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SETUP_NODE_RE = /^\s*-\s+uses:\s*actions\/setup-node@[^\s#]+(?:\s+#.*)?$/;
const NODE_VERSION_RE = /^\s*node-version:\s*([^#]+?)(?:\s+#.*)?$/;
const JOB_RE = /^  ([A-Za-z0-9_-]+):\s*(?:#.*)?$/;
const REPOSITORY_JS_RE = /(?:^|[|;&]\s*|\s)(?:node\s+(?:\.\/)?scripts\/|pnpm\s+(?:run\s+)?release:)/;

function indentOf(line) {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function stripQuotes(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function inspectReleaseWorkflowRuntime(
  text,
  allowedNodeVersions,
  file = "<workflow>",
) {
  const lines = text.split(/\r?\n/);
  const failures = [];
  const jobs = [];
  let current = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const jobMatch = line.match(JOB_RE);
    if (jobMatch && jobMatch[1] !== "jobs") {
      current = {
        name: jobMatch[1],
        line: index + 1,
        setupNode: [],
        repositoryJs: [],
      };
      jobs.push(current);
      continue;
    }
    if (!current) continue;

    if (SETUP_NODE_RE.test(line)) {
      const stepIndent = indentOf(line);
      let version = null;
      let versionLine = null;
      for (let child = index + 1; child < lines.length; child += 1) {
        const raw = lines[child];
        if (!raw.trim() || /^\s*#/.test(raw)) continue;
        const indent = indentOf(raw);
        if (indent <= stepIndent) break;
        const match = raw.match(NODE_VERSION_RE);
        if (match) {
          version = stripQuotes(match[1]);
          versionLine = child + 1;
          break;
        }
      }
      current.setupNode.push({ line: index + 1, version, versionLine });
    }

    if (REPOSITORY_JS_RE.test(line.trim())) {
      current.repositoryJs.push({ line: index + 1, command: line.trim() });
    }
  }

  for (const job of jobs) {
    if (job.repositoryJs.length === 0) continue;
    if (job.setupNode.length === 0) {
      failures.push(
        `${file}:${job.line}: job ${job.name} executes repository JavaScript without actions/setup-node`,
      );
      continue;
    }
    if (job.setupNode.length > 1) {
      failures.push(
        `${file}:${job.line}: job ${job.name} has multiple actions/setup-node steps; verifier runtime must be unambiguous`,
      );
      continue;
    }

    const setup = job.setupNode[0];
    if (!setup.version) {
      failures.push(
        `${file}:${setup.line}: job ${job.name} actions/setup-node must declare node-version explicitly`,
      );
      continue;
    }
    if (!allowedNodeVersions.includes(setup.version)) {
      failures.push(
        `${file}:${setup.versionLine ?? setup.line}: job ${job.name} node-version ${setup.version} is not allowed by the release toolchain contract`,
      );
    }
    const firstJsLine = job.repositoryJs[0].line;
    if (setup.line > firstJsLine) {
      failures.push(
        `${file}:${firstJsLine}: job ${job.name} executes repository JavaScript before actions/setup-node`,
      );
    }
  }

  return {
    jobs: jobs.filter((job) => job.repositoryJs.length > 0),
    failures,
  };
}

export function validateReleaseWorkflowRuntime(root = ".") {
  const absoluteRoot = resolve(root);
  const workflow = resolve(
    absoluteRoot,
    ".github",
    "workflows",
    "release-integrity.yml",
  );
  const toolchain = resolve(absoluteRoot, "config", "release-toolchain.json");
  if (!existsSync(workflow)) throw new Error(`missing release workflow: ${workflow}`);
  if (!existsSync(toolchain)) throw new Error(`missing release toolchain contract: ${toolchain}`);

  const contract = JSON.parse(readFileSync(toolchain, "utf8"));
  const allowedNodeVersions = contract?.node?.ci;
  if (
    !Array.isArray(allowedNodeVersions) ||
    allowedNodeVersions.length === 0 ||
    allowedNodeVersions.some((version) => typeof version !== "string" || !version)
  ) {
    throw new Error("release toolchain contract must declare non-empty node.ci versions");
  }

  const inspected = inspectReleaseWorkflowRuntime(
    readFileSync(workflow, "utf8"),
    allowedNodeVersions,
    ".github/workflows/release-integrity.yml",
  );
  return {
    schema: "totem.workflow-node-runtime/v1",
    allowed_node_versions: allowedNodeVersions,
    jobs: inspected.jobs,
    failures: inspected.failures,
    overall: inspected.failures.length === 0 ? "PASS" : "FAIL",
  };
}

export function main(argv = process.argv.slice(2)) {
  let root = ".";
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") {
      root = argv[index + 1];
      if (!root) throw new Error("--repo requires a path");
      index += 1;
    } else if (arg === "--json") json = true;
    else throw new Error(`unknown argument: ${arg}`);
  }

  const result = validateReleaseWorkflowRuntime(root);
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    for (const failure of result.failures) console.error(`FAIL ${failure}`);
    console.log(
      `release verifier Node runtime: ${result.overall} (${result.jobs.length} repository-JS jobs, ${result.failures.length} failures)`,
    );
  }
  return result.failures.length === 0 ? 0 : 1;
}

const isEntryPoint =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) process.exitCode = main();
