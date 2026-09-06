import type {
  AgentEventDraft,
  AgentMcpServer,
  AgentMessageRequest,
  AgentProviderCapabilities,
} from "./index.js";
import {
  CliAgentProvider,
  type CliSessionState,
  type ProcessRunner,
  type SpawnSpec,
} from "./cli.js";

function codexMcpConfig(servers: AgentMcpServer[]): string[] {
  const args: string[] = [];
  for (const server of servers) {
    const command = [server.command, ...(server.args ?? [])].join(" ");
    args.push(
      "-c",
      `mcp_servers.${server.id}.command=${JSON.stringify(command)}`,
    );
  }
  return args;
}

export class CodexCliProvider extends CliAgentProvider {
  constructor(
    runner?: ProcessRunner,
    private readonly binary = "codex",
  ) {
    super("codex", runner);
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
    const nativeId = this.getNativeSessionId(state);
    const args = nativeId
      ? ["exec", "resume", nativeId, request.content, "--json"]
      : ["exec", request.content, "--json"];
    const workspace = state.session.workspace;
    if (workspace) {
      args.push(
        "--sandbox",
        workspace.access === "read-write" ? "workspace-write" : "read-only",
      );
    }
    args.push(...codexMcpConfig(state.session.mcpServers));
    return { command: this.command(), args, cwd: workspace?.path };
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
      typeof value.session_id === "string"
        ? value.session_id
        : typeof value.thread_id === "string"
          ? value.thread_id
          : undefined;
    if (nativeSessionId) this.setNativeSessionId(state, nativeSessionId);

    const kind = typeof value.type === "string" ? value.type : "event";
    const message =
      typeof value.message === "string"
        ? value.message
        : typeof value.text === "string"
          ? value.text
          : undefined;

    return [
      {
        type: /error|failed/i.test(kind)
          ? "agent.error"
          : /completed|result|message/i.test(kind) && message
            ? "agent.message"
            : "agent.progress",
        sessionId: state.session.id,
        taskId: request.taskId,
        correlationId: request.correlationId,
        payload: {
          providerId: this.id,
          nativeType: kind,
          ...(message ? { text: message } : {}),
          ...(nativeSessionId ? { nativeSessionId } : {}),
        },
      },
    ];
  }
}
