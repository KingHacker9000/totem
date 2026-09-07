import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SHA40 = /^[0-9a-f]{40}$/i;

export function inspectWorkflowText(text, file = "<workflow>") {
  const entries = [];
  const failures = [];
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const match = rawLine.match(/^\s*-?\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/);
    if (!match) continue;
    const spec = match[1];
    if (spec.startsWith("./") || spec.startsWith("docker://")) continue;
    const at = spec.lastIndexOf("@");
    if (at <= 0) {
      failures.push(
        `${file}:${index + 1}: external action is missing an immutable ref: ${spec}`,
      );
      continue;
    }
    const action = spec.slice(0, at);
    const ref = spec.slice(at + 1);
    entries.push({ file, line: index + 1, action, ref });
    if (!SHA40.test(ref)) {
      failures.push(
        `${file}:${index + 1}: ${action}@${ref} is mutable; pin a 40-character commit SHA`,
      );
    }
  }
  return { entries, failures };
}

export function validateRepository(root) {
  const absoluteRoot = resolve(root);
  const workflowsRoot = join(absoluteRoot, ".github", "workflows");
  if (!existsSync(workflowsRoot)) {
    return { root: absoluteRoot, workflows: 0, entries: [], failures: [] };
  }
  const files = readdirSync(workflowsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => join(workflowsRoot, entry.name))
    .sort();
  const entries = [];
  const failures = [];
  for (const file of files) {
    const inspected = inspectWorkflowText(
      readFileSync(file, "utf8"),
      relative(absoluteRoot, file),
    );
    entries.push(...inspected.entries);
    failures.push(...inspected.failures);
  }
  return { root: absoluteRoot, workflows: files.length, entries, failures };
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
  const results = repos.map(validateRepository);
  const failureCount = results.reduce(
    (sum, result) => sum + result.failures.length,
    0,
  );
  const entryCount = results.reduce(
    (sum, result) => sum + result.entries.length,
    0,
  );
  const summary = {
    schema: "totem.workflow-actions/v1",
    repositories: results,
    external_action_count: entryCount,
    failure_count: failureCount,
    overall: failureCount === 0 ? "PASS" : "FAIL",
  };
  if (json) console.log(JSON.stringify(summary, null, 2));
  else {
    for (const result of results) {
      console.log(
        `${result.root}: ${result.workflows} workflows, ${result.entries.length} external actions`,
      );
      for (const entry of result.entries)
        console.log(
          `  ${entry.file}:${entry.line} ${entry.action}@${entry.ref}`,
        );
      for (const failure of result.failures) console.error(`  FAIL ${failure}`);
    }
    console.log(
      `workflow action pinning: ${summary.overall} (${entryCount} actions, ${failureCount} failures)`,
    );
  }
  return failureCount === 0 ? 0 : 1;
}

const isEntryPoint =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) process.exitCode = main();
