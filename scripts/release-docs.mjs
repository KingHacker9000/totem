import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "coverage", ".turbo"]);
const PNPM_BUILTINS = new Set([
  "add",
  "audit",
  "config",
  "create",
  "dlx",
  "exec",
  "fetch",
  "import",
  "init",
  "install",
  "link",
  "list",
  "outdated",
  "pack",
  "patch",
  "prune",
  "publish",
  "rebuild",
  "remove",
  "root",
  "run",
  "setup",
  "store",
  "unlink",
  "update",
  "why",
]);
const PRIVATE_PORTAL_REPOS = ["totem-portal-theme", "totem-portal-hardware"];

function walk(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function packageScripts(root) {
  const scripts = new Set();
  for (const file of walk(root)) {
    if (file.endsWith("package.json")) {
      try {
        const pkg = JSON.parse(readFileSync(file, "utf8"));
        for (const name of Object.keys(pkg.scripts ?? {})) scripts.add(name);
      } catch {
        // Package parsing belongs to repository CI; this validator only inventories valid JSON files.
      }
    }
  }
  return scripts;
}

function cleanLinkTarget(raw) {
  const target = raw.trim().replace(/^<|>$/g, "");
  if (!target || target.startsWith("#")) return null;
  if (/^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(target)) return null;
  const withoutTitle = target.match(/^(?:[^\s]+|<[^>]+>)/)?.[0] ?? target;
  const hash = withoutTitle.indexOf("#");
  const query = withoutTitle.indexOf("?");
  const end = [hash, query].filter((index) => index >= 0).sort((a, b) => a - b)[0];
  return decodeURIComponent(end === undefined ? withoutTitle : withoutTitle.slice(0, end));
}

function validateLinks(root, markdownFile, text, failures) {
  const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of text.matchAll(linkPattern)) {
    const rawTarget = match[1];
    const privateRepo = PRIVATE_PORTAL_REPOS.find((name) => rawTarget.includes(name));
    if (privateRepo) {
      failures.push(`${relative(root, markdownFile)}: public documentation links to private repository ${privateRepo}`);
      continue;
    }
    const target = cleanLinkTarget(rawTarget);
    if (!target) continue;
    const resolved = isAbsolute(target) ? join(root, target) : resolve(dirname(markdownFile), target);
    const normalizedRoot = `${normalize(root)}${process.platform === "win32" ? "\\" : "/"}`;
    const normalizedTarget = normalize(resolved);
    if (normalizedTarget !== normalize(root) && !`${normalizedTarget}${process.platform === "win32" ? "\\" : "/"}`.startsWith(normalizedRoot) && !normalizedTarget.startsWith(normalizedRoot)) {
      failures.push(`${relative(root, markdownFile)}: relative link escapes repository: ${rawTarget}`);
      continue;
    }
    if (!existsSync(resolved)) failures.push(`${relative(root, markdownFile)}: broken relative link: ${rawTarget}`);
  }
}

function fencedShellBlocks(text) {
  const blocks = [];
  const pattern = /```(?:bash|sh|shell|zsh|powershell|pwsh)?\s*\n([\s\S]*?)```/gi;
  for (const match of text.matchAll(pattern)) blocks.push(match[1]);
  return blocks;
}

function validateCommands(root, markdownFile, text, scripts, failures) {
  for (const block of fencedShellBlocks(text)) {
    for (const rawLine of block.split(/\r?\n/)) {
      const line = rawLine.trim().replace(/^[$>]\s*/, "");
      if (!line || line.startsWith("#")) continue;

      const npmRun = line.match(/^npm\s+(?:run\s+)?([A-Za-z0-9:_-]+)(?:\s|$)/);
      if (npmRun && !["install", "ci", "exec", "init", "pack", "publish"].includes(npmRun[1]) && !scripts.has(npmRun[1])) {
        failures.push(`${relative(root, markdownFile)}: undocumented npm script '${npmRun[1]}' is not present in any package.json`);
      }

      const pnpmRun = line.match(/^pnpm\s+(?:run\s+)?([A-Za-z0-9:_-]+)(?:\s|$)/);
      if (pnpmRun && !PNPM_BUILTINS.has(pnpmRun[1]) && !scripts.has(pnpmRun[1])) {
        failures.push(`${relative(root, markdownFile)}: undocumented pnpm script '${pnpmRun[1]}' is not present in any package.json`);
      }
    }
  }
}

export function validateRepository(root) {
  const absoluteRoot = resolve(root);
  if (!existsSync(absoluteRoot) || !statSync(absoluteRoot).isDirectory()) {
    return { root: absoluteRoot, markdownFiles: 0, scripts: 0, failures: [`repository root does not exist: ${absoluteRoot}`] };
  }

  const scripts = packageScripts(absoluteRoot);
  const markdown = walk(absoluteRoot).filter((file) => extname(file).toLowerCase() === ".md");
  const failures = [];
  for (const file of markdown) {
    const text = readFileSync(file, "utf8");
    validateLinks(absoluteRoot, file, text, failures);
    validateCommands(absoluteRoot, file, text, scripts, failures);
  }
  return { root: absoluteRoot, markdownFiles: markdown.length, scripts: scripts.size, failures };
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
  const failureCount = results.reduce((sum, result) => sum + result.failures.length, 0);
  const summary = {
    schema: "totem.release-docs/v1",
    repositories: results.map((result) => ({
      root: result.root,
      markdown_files: result.markdownFiles,
      package_scripts: result.scripts,
      failures: result.failures,
    })),
    failure_count: failureCount,
    overall: failureCount === 0 ? "PASS" : "FAIL",
  };

  if (json) console.log(JSON.stringify(summary, null, 2));
  else {
    for (const result of results) {
      console.log(`${result.root}: ${result.markdownFiles} markdown files, ${result.scripts} package scripts`);
      for (const failure of result.failures) console.error(`  FAIL ${failure}`);
    }
    console.log(`release documentation validation: ${summary.overall} (${failureCount} failures)`);
  }
  return failureCount === 0 ? 0 : 1;
}

const isEntryPoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) process.exitCode = main();
