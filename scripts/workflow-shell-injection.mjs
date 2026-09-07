import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const EXPRESSION = /\$\{\{\s*([^}]+?)\s*\}\}/g;

function isRiskyExpression(expression) {
  const value = expression.trim();
  return (
    /^inputs\./.test(value) ||
    /^github\.event(?:\.|$)/.test(value) ||
    /^github\.(?:head_ref|ref|ref_name)(?:\b|\.)/.test(value)
  );
}

function inspectCommand(command, file, line, failures) {
  for (const match of command.matchAll(EXPRESSION)) {
    const expression = match[1].trim();
    if (!isRiskyExpression(expression)) continue;
    failures.push(
      `${file}:${line}: unsafe GitHub expression in run script: \${{ ${expression} }}; pass untrusted/external values through env: and quote the environment variable in the script`,
    );
  }
}

export function inspectWorkflowShellExpressions(text, file = "<workflow>") {
  const lines = text.split(/\r?\n/);
  const failures = [];
  let runBlocks = 0;
  let expressions = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const run = line.match(/^(\s*)run:\s*(.*)$/);
    if (!run) continue;
    runBlocks += 1;
    const [, indent, remainder] = run;
    const baseIndent = indent.length;

    if (
      remainder === "|" ||
      remainder === ">" ||
      remainder.startsWith("|-") ||
      remainder.startsWith(">-")
    ) {
      for (let child = index + 1; child < lines.length; child += 1) {
        const raw = lines[child];
        if (!raw.trim()) continue;
        const childIndent = raw.match(/^\s*/)[0].length;
        if (childIndent <= baseIndent) break;
        expressions += [...raw.matchAll(EXPRESSION)].length;
        inspectCommand(raw, file, child + 1, failures);
        index = child;
      }
      continue;
    }

    expressions += [...remainder.matchAll(EXPRESSION)].length;
    inspectCommand(remainder, file, index + 1, failures);
  }

  return { runBlocks, expressions, failures };
}

export function validateRepository(root) {
  const absoluteRoot = resolve(root);
  const workflowsRoot = join(absoluteRoot, ".github", "workflows");
  if (!existsSync(workflowsRoot)) {
    return {
      root: absoluteRoot,
      workflows: 0,
      run_blocks: 0,
      expressions: 0,
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
  let runBlocks = 0;
  let expressions = 0;

  for (const file of files) {
    const relativeFile = relative(absoluteRoot, file);
    const inspected = inspectWorkflowShellExpressions(
      readFileSync(file, "utf8"),
      relativeFile,
    );
    results.push({ file: relativeFile, ...inspected });
    failures.push(...inspected.failures);
    runBlocks += inspected.runBlocks;
    expressions += inspected.expressions;
  }

  return {
    root: absoluteRoot,
    workflows: files.length,
    run_blocks: runBlocks,
    expressions,
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
  const runBlockCount = repositories.reduce(
    (sum, repository) => sum + repository.run_blocks,
    0,
  );
  const expressionCount = repositories.reduce(
    (sum, repository) => sum + repository.expressions,
    0,
  );
  const summary = {
    schema: "totem.workflow-shell-injection/v1",
    repositories,
    workflow_count: workflowCount,
    run_block_count: runBlockCount,
    expression_count: expressionCount,
    failure_count: failureCount,
    overall: failureCount === 0 ? "PASS" : "FAIL",
  };

  if (json) console.log(JSON.stringify(summary, null, 2));
  else {
    for (const repository of repositories) {
      console.log(
        `${repository.root}: ${repository.workflows} workflows, ${repository.run_blocks} run blocks`,
      );
      for (const failure of repository.failures) console.error(`  FAIL ${failure}`);
    }
    console.log(
      `workflow shell injection: ${summary.overall} (${workflowCount} workflows, ${runBlockCount} run blocks, ${expressionCount} expressions, ${failureCount} failures)`,
    );
  }
  return failureCount === 0 ? 0 : 1;
}

const isEntryPoint =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) process.exitCode = main();
