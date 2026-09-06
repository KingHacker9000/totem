import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CliAgentProvider,
  resolveExecutable,
  type SpawnSpec,
} from "./index.js";
import type {
  AgentMessageRequest,
  AgentProviderCapabilities,
  CliSessionState,
} from "./index.js";

describe("resolveExecutable", () => {
  it("finds a bare command on PATH, honoring PATHEXT on Windows", () => {
    const dir = mkdtempSync(join(tmpdir(), "totem-exec-"));
    const isWindows = process.platform === "win32";
    const filename = isWindows ? "faketool.cmd" : "faketool";
    const full = join(dir, filename);
    writeFileSync(full, isWindows ? "@echo off\n" : "#!/bin/sh\n");
    if (!isWindows) chmodSync(full, 0o755);

    const env = {
      PATH: `${dir}${delimiter}${process.env.PATH ?? ""}`,
      PATHEXT: ".COM;.EXE;.BAT;.cmd",
    };
    expect(resolveExecutable("faketool", env)?.toLowerCase()).toBe(
      full.toLowerCase(),
    );
    expect(resolveExecutable("does-not-exist-xyz", env)).toBeUndefined();
  });

  it("returns an explicit path unchanged when it exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "totem-exec-"));
    const full = join(dir, "tool.js");
    writeFileSync(full, "");
    expect(resolveExecutable(full)).toBe(full);
    expect(resolveExecutable(join(dir, "missing.js"))).toBeUndefined();
  });
});

class RecordingProvider extends CliAgentProvider {
  lastSpec: SpawnSpec | undefined;

  constructor() {
    super("recording", () => {
      // Do not actually spawn anything; buildInvocation records the spec.
      return {
        stdout: (async function* () {})(),
        stderr: (async function* () {})(),
        exit: Promise.resolve(0),
        interrupt: () => {},
        terminate: () => {},
      };
    });
  }

  protected command(): string {
    return "recording-cli";
  }
  protected probeArgs(): string[] {
    return ["--version"];
  }
  protected capabilities(): AgentProviderCapabilities {
    return {
      streaming: true,
      resume: false,
      interrupt: true,
      workspaces: true,
      mcp: false,
    };
  }
  protected buildInvocation(
    _state: CliSessionState,
    request: AgentMessageRequest,
  ): SpawnSpec {
    const spec = { command: this.command(), args: [request.content] };
    this.lastSpec = spec;
    return spec;
  }
  protected parseLine(): [] {
    return [];
  }
}

describe("CliAgentProvider", () => {
  it("passes prompt content as a single argv element (no shell interpolation)", async () => {
    const provider = new RecordingProvider();
    const session = await provider.startSession();
    await provider.sendMessage(session.id, {
      content: 'weather in "Paris" & echo pwned',
      taskId: "task-1",
    });
    expect(provider.lastSpec?.args).toEqual([
      'weather in "Paris" & echo pwned',
    ]);
  });
});
