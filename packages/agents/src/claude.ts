import type {
  AgentEventDraft,
  AgentMessageRequest,
  AgentProviderCapabilities,
} from "./index.js";
import {
  CliAgentProvider,
  type CliSessionState,
  type ProcessRunner,
  type SpawnSpec,
} from "./cli.js";

export class ClaudeCodeCliProvider extends CliAgentProvider {
  constructor(
    runner?: ProcessRunner,
    private readonly binary = "claude",
  ) {
    super("claude-code", runner);
  }

  protected command(): string {
    return this.binary;
  }

  protected probeArgs(): string[] {
    return ["--version"];
  }

  protected capabilities(): AgentProviderCapabilities {
    return {
      streaming: true,
      resume: true,
      interrupt: true,
      workspaces: true,
      mcp: true,
    };
  }

  protected buildInvocation(
    state: CliSessionState,
    request: AgentMessageRequest,
  ): SpawnSpec {
    const args = [
      "-p",
      request.content,
      "--output-format",
      "stream-json",
      "--verbose",
    ];
    const nativeId = this.getNativeSessionId(state);
    if (nativeId) args.push("--resume", nativeId);
    args.push(
      "--permission-mode",
      state.session.workspace?.access === "read-only" ? "plan" : "acceptEdits",
    );
    if (state.session.mcpServers.length) {
      const mcpServers = Object.fromEntries(
        state.session.mcpServers.map((server) => [
          server.id,
          {
            command: server.command,
            args: server.args ?? [],
            env: server.env ?? {},
          },
        ]),
      );
      args.push("--mcp-config", JSON.stringify({ mcpServers }));
    }
    return {
      command: this.command(),
      args,
      cwd: state.session.workspace?.path,
    };
  }

  protected parseLine(
    state: CliSessionState,
    line: string,
    request: AgentMessageRequest,
  ): AgentEventDraft[] {
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return [
        {
          type: "agent.progress",
          sessionId: state.session.id,
          taskId: request.taskId,
          correlationId: request.correlationId,
          payload: { providerId: this.id, text: line },
        },
      ];
    }

    const nativeSessionId =
      typeof value.session_id === "string" ? value.session_id : undefined;
    if (nativeSessionId) this.setNativeSessionId(state, nativeSessionId);

    const kind = typeof value.type === "string" ? value.type : "event";
    const result = typeof value.result === "string" ? value.result : undefined;
    const message =
      value.message && typeof value.message === "object"
        ? (value.message as { content?: unknown })
        : undefined;
    const text =
      result ??
      (typeof message?.content === "string" ? message.content : undefined);

    return [
      {
        type:
          /error/i.test(kind) || value.is_error === true
            ? "agent.error"
            : kind === "result" || text
              ? "agent.message"
              : "agent.progress",
        sessionId: state.session.id,
        taskId: request.taskId,
        correlationId: request.correlationId,
        payload: {
          providerId: this.id,
          nativeType: kind,
          ...(text ? { text } : {}),
          ...(nativeSessionId ? { nativeSessionId } : {}),
        },
      },
    ];
  }
}
