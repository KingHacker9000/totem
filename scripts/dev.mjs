import { spawn, spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";

/**
 * Spawn a `pnpm <args>` child.
 *
 * On Windows, `pnpm` resolves to `pnpm.cmd`; current Node refuses to spawn a
 * `.cmd` directly (EINVAL) and spawning with `shell: true` triggers a
 * DeprecationWarning (DEP0190) on every launch. Going through `cmd.exe`
 * explicitly avoids both. `stdio` and other options are forwarded.
 */
function spawnPnpm(args, options) {
  if (isWindows) {
    const comspec = process.env.ComSpec || "cmd.exe";
    return spawn(comspec, ["/d", "/s", "/c", "pnpm", ...args], {
      ...options,
      windowsVerbatimArguments: true,
    });
  }
  return spawn("pnpm", args, options);
}

async function directoryExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function withSiblingDiscoveryDefaults(env) {
  const parent = resolve(repoRoot, "..");
  const extensionRoot = resolve(parent, "totem-base-extensions");
  const themeRoot = resolve(parent, "totem-base-themes");
  const next = { ...env, TOTEM_ENV: env.TOTEM_ENV || "development" };

  if (!next.TOTEM_EXTENSION_ROOTS && (await directoryExists(extensionRoot))) {
    next.TOTEM_EXTENSION_ROOTS = extensionRoot;
  }
  if (!next.TOTEM_THEME_ROOTS && (await directoryExists(themeRoot))) {
    next.TOTEM_THEME_ROOTS = themeRoot;
  }

  return next;
}

const env = await withSiblingDiscoveryDefaults(process.env);
const processes = [
  { label: "core", filter: "@totem/core" },
  { label: "dashboard", filter: "@totem/dashboard" },
  { label: "display", filter: "@totem/display" },
];

console.log("Totem Phase 1 development stack");
console.log(
  `  core:      http://${env.TOTEM_HOST || "127.0.0.1"}:${env.TOTEM_PORT || "3000"}`,
);
console.log("  dashboard: http://127.0.0.1:5173");
console.log("  display:   http://127.0.0.1:5174");
console.log(
  "  provider:  deterministic MockAgentProvider is local/in-process; no credentials required",
);
if (env.TOTEM_EXTENSION_ROOTS) {
  console.log(
    `  extension roots: ${env.TOTEM_EXTENSION_ROOTS.split(delimiter).join(", ")}`,
  );
}
if (env.TOTEM_THEME_ROOTS) {
  console.log(
    `  theme roots:     ${env.TOTEM_THEME_ROOTS.split(delimiter).join(", ")}`,
  );
}
console.log("Press Ctrl+C once to stop the complete stack.\n");

const children = processes.map(({ label, filter }) => {
  const child = spawnPnpm(["--filter", filter, "dev"], {
    cwd: repoRoot,
    env,
    stdio: "inherit",
    windowsHide: false,
  });

  return { label, child };
});

let stopping = false;
let exitCode = 0;

function stopChild(child, signal) {
  if (child.killed || child.exitCode !== null || child.pid === undefined) {
    return;
  }

  if (isWindows) {
    // Each managed child is a `cmd.exe` wrapper around `pnpm`; `child.kill()`
    // only terminates that wrapper and orphans the underlying dev servers.
    // `taskkill /T` tears down the whole tree.
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }

  child.kill(signal);
}

function stopAll(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;

  for (const { child } of children) {
    stopChild(child, signal);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => stopAll(signal));
}

await Promise.all(
  children.map(
    ({ label, child }) =>
      new Promise((resolveChild) => {
        child.once("error", (error) => {
          if (!stopping) {
            exitCode = 1;
            console.error(`[${label}] failed to start: ${error.message}`);
            stopAll();
          }
        });

        child.once("close", (code, signal) => {
          if (!stopping) {
            exitCode = code && code !== 0 ? code : 1;
            console.error(
              `[${label}] exited unexpectedly (${signal ?? `code ${code}`}); stopping stack.`,
            );
            stopAll();
          }
          resolveChild();
        });
      }),
  ),
);

process.exitCode = exitCode;
