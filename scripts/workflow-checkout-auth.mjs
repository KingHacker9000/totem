import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const CHECKOUT_RE = /^\s*-\s+uses:\s*actions\/checkout@[^\s#]+(?:\s+#.*)?$/;

function indentOf(line) {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

export function inspectWorkflowCheckoutCredentials(text, file = "<workflow>") {
  const lines = text.split(/\r?\n/);
  const entries = [];
  const failures = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!CHECKOUT_RE.test(line)) continue;

    const stepIndent = indentOf(line);
    const entry = {
      line: index + 1,
      persistCredentials: null,
      persistCredentialsLine: null,
    };
    let withIndent = null;

    for (let child = index + 1; child < lines.length; child += 1) {
      const raw = lines[child];
      if (!raw.trim() || /^\s*#/.test(raw)) continue;
      const indent = indentOf(raw);

      if (indent <= stepIndent) break;
      if (withIndent === null) {
        if (indent === stepIndent + 2 && /^\s*with:\s*(?:#.*)?$/.test(raw)) {
          withIndent = indent;
        }
        continue;
      }

      if (indent <= withIndent) {
        withIndent = null;
        if (indent <= stepIndent) break;
        if (indent === stepIndent + 2 && /^\s*with:\s*(?:#.*)?$/.test(raw)) {
          withIndent = indent;
        }
        continue;
      }

      const match = raw.match(/^\s*persist-credentials:\s*(.*?)\s*$/);
      if (!match) continue;
      if (entry.persistCredentialsLine !== null) {
        failures.push(
          `${file}:${child + 1}: duplicate actions/checkout persist-credentials declaration`,
        );
        continue;
      }
      entry.persistCredentials = match[1].replace(/\s+#.*$/, "").trim();
      entry.persistCredentialsLine = child + 1;
    }

    entries.push(entry);
    if (entry.persistCredentialsLine === null) {
      failures.push(
        `${file}:${entry.line}: actions/checkout must explicitly set persist-credentials: false`,
      );
    } else if (entry.persistCredentials !== "false") {
      failures.push(
        `${file}:${entry.persistCredentialsLine}: actions/checkout persist-credentials must be false`,
      );
    }
  }

  return { entries, failures };
}

export function validateRepository(root) {
  const absoluteRoot = resolve(root);
  const workflowsRoot = join(absoluteRoot, ".github", "workflows");
  if (!existsSync(workflowsRoot)) {
    return {
      root: absoluteRoot,
      workflows: 0,
      checkouts: 0,
      results: [],
      failures: [],
    };
  }

  const files = readdirSync(workflowsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => join(workflowsRoot, entry.name))
    .sort();
  const results = [];
  const failures = [];
  let checkouts = 0;

  for (const file of files) {
    const relativeFile = relative(absoluteRoot, file);
    const inspected = inspectWorkflowCheckoutCredentials(
      readFileSync(file, "utf8"),
      relativeFile,
    );
    results.push({ file: relativeFile, ...inspected });
    checkouts += inspected.entries.length;
    failures.push(...inspected.failures);
  }

  return {
    root: absoluteRoot,
    workflows: files.length,
    checkouts,
    results,
    failures,
  };
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
  const checkoutCount = repositories.reduce(
    (sum, repository) => sum + repository.checkouts,
    0,
  );
  const summary = {
    schema: "totem.workflow-checkout-credentials/v1",
    policy: { "persist-credentials": false },
    repositories,
    workflow_count: workflowCount,
    checkout_count: checkoutCount,
    failure_count: failureCount,
    overall: failureCount === 0 ? "PASS" : "FAIL",
  };

  if (json) console.log(JSON.stringify(summary, null, 2));
  else {
    for (const repository of repositories) {
      console.log(
        `${repository.root}: ${repository.workflows} workflows, ${repository.checkouts} checkout steps`,
      );
      for (const failure of repository.failures)
        console.error(`  FAIL ${failure}`);
    }
    console.log(
      `workflow checkout credentials: ${summary.overall} (${checkoutCount} checkouts, ${failureCount} failures)`,
    );
  }
  return failureCount === 0 ? 0 : 1;
}

const isEntryPoint =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) process.exitCode = main();
