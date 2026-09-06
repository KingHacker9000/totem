import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import type {
  AgentEventDraft,
  AgentMessageRequest,
  AgentMcpServer,
  AgentProvider,
  AgentProviderCapabilities,
  AgentProviderStatus,
  AgentSession,
  AgentWorkspace,
  StartSessionOptions,
} from "./index.js";
import { AgentProviderError } from "./index.js";

export interface SpawnSpec {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface RunningProcess {
  stdout: AsyncIterable<string>;
  stderr: AsyncIterable<string>;
  exit: Promise<number | null>;
  interrupt(): void;
  terminate(): void;
}

export type ProcessRunner = (spec: SpawnSpec) => RunningProcess;

async function* lines(stream: Readable): AsyncIterable<string> {
  let pending = "";
  stream.setEncoding("utf8");
  for await (const chunk of stream) {
    pending += String(chunk);
    let index = pending.indexOf("\n");
    while (index >= 0) {
      yield pending.slice(0, index).replace(/\r$/, "");
      pending = pending.slice(index + 1);
      index = pending.indexOf("\n");
    }
  }
  if (pending) yield pending;
}

export const nodeProcessRunner: ProcessRunner = (spec) => {
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    stdout: lines(child.stdout),
    stderr: lines(child.stderr),
    exit: new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    }),
    interrupt: () => child.kill("SIGINT"),
    terminate: () => child.kill("SIGTERM"),
  };
};

export interface CliSessionState {
  session: AgentSession;
  nativeSessionId?: string;
  queue: AgentEventDraft[];
  waiters: Array<() => void>;
  process?: RunningProcess;
}

export abstract class CliAgentProvider
  implements AgentProvider<AgentEventDraft>
{
  readonly #sessions = new Map<string, CliSessionState>();

  protected constructor(
    readonly id: string,
    protected readonly runner: ProcessRunner = nodeProcessRunner,
  ) {}

  protected abstract command(): string;
  protected abstract buildInvocation(
    state: CliSessionState,
    request: AgentMessageRequest,
  ): SpawnSpec;
  protected abstract parseLine(
    state: CliSessionState,
    line: string,
    request: AgentMessageRequest,
  ): AgentEventDraft[];
  protected abstract probeArgs(): string[];
  protected abstract capabilities(): AgentProviderCapabilities;

  async probeCapabilities(): Promise<AgentProviderCapabilities> {
    return this.capabilities();
  }

  async getStatus(): Promise<AgentProviderStatus> {
    try {
      const process = this.runner({
        command: this.command(),
        args: this.probeArgs(),
      });
      const code = await process.exit;
      return {
        id: this.id,
        available: code === 0,
        detail: code === 0 ? "CLI available" : `CLI probe exited ${code}`,
      };
    } catch (error) {
      return {
        id: this.id,
        available: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async startSession(options: StartSessionOptions = {}): Promise<AgentSession> {
    const session: AgentSession = {
      id: `${this.id}-${randomUUID()}`,
      providerId: this.id,
      status: "active",
      ...(options.workspace ? { workspace: options.workspace } : {}),
      mcpServers: [...(options.mcpServers ?? [])],
    };
    this.#sessions.set(session.id, { session, queue: [], waiters: [] });
    return structuredClone(session);
  }

  async resumeSession(sessionId: string): Promise<AgentSession> {
    const state = this.state(sessionId);
    state.session.status = "active";
    return structuredClone(state.session);
  }

  async attachWorkspace(
    sessionId: string,
    workspace: AgentWorkspace,
  ): Promise<void> {
    this.state(sessionId).session.workspace = workspace;
  }

  async registerMcpServers(
    sessionId: string,
    servers: AgentMcpServer[],
  ): Promise<void> {
    this.state(sessionId).session.mcpServers = structuredClone(servers);
  }

  async sendMessage(
    sessionId: string,
    request: AgentMessageRequest,
  ): Promise<void> {
    const state = this.state(sessionId);
    if (state.process) {
      throw new AgentProviderError(
        this.id,
        "provider_busy",
        "Session already has an active turn",
        sessionId,
      );
    }
    const process = this.runner(this.buildInvocation(state, request));
    state.process = process;
    this.push(state, {
      type: "agent.started",
      sessionId,
      taskId: request.taskId,
      correlationId: request.correlationId,
      payload: { providerId: this.id },
    });
    void this.consume(state, process, request);
  }

  async *streamEvents(sessionId: string): AsyncIterable<AgentEventDraft> {
    const state = this.state(sessionId);
    while (state.session.status !== "terminated" || state.queue.length) {
      if (!state.queue.length) {
        await new Promise<void>((resolve) => state.waiters.push(resolve));
      }
      while (state.queue.length) {
        const event = state.queue.shift();
        if (event) yield event;
      }
      if (!state.process && state.session.status !== "active") break;
    }
  }

  async interrupt(sessionId: string): Promise<void> {
    const state = this.state(sessionId);
    state.process?.interrupt();
    state.session.status = "interrupted";
    this.push(state, {
      type: "agent.interrupted",
      sessionId,
      payload: { providerId: this.id },
    });
  }

  async terminate(sessionId: string): Promise<void> {
    const state = this.state(sessionId);
    state.process?.terminate();
    state.process = undefined;
    state.session.status = "terminated";
    this.push(state, {
      type: "agent.terminated",
      sessionId,
      payload: { providerId: this.id },
    });
  }

  protected setNativeSessionId(state: CliSessionState, id: string): void {
    state.nativeSessionId = id;
  }

  protected getNativeSessionId(state: CliSessionState): string | undefined {
    return state.nativeSessionId;
  }

  private state(id: string): CliSessionState {
    const state = this.#sessions.get(id);
    if (!state) {
      throw new AgentProviderError(
        this.id,
        "session_not_found",
        `Unknown session '${id}'`,
        id,
      );
    }
    return state;
  }

  private wakeWaiters(state: CliSessionState): void {
    for (const wake of state.waiters.splice(0)) wake();
  }

  private push(state: CliSessionState, event: AgentEventDraft): void {
    state.queue.push(event);
    this.wakeWaiters(state);
  }

  private async consume(
    state: CliSessionState,
    process: RunningProcess,
    request: AgentMessageRequest,
  ): Promise<void> {
    try {
      for await (const line of process.stdout) {
        for (const event of this.parseLine(state, line, request)) {
          this.push(state, event);
        }
      }
      const code = await process.exit;
      if (state.session.status === "active") {
        this.push(state, {
          type: code === 0 ? "agent.completed" : "agent.error",
          sessionId: state.session.id,
          taskId: request.taskId,
          correlationId: request.correlationId,
          payload:
            code === 0
              ? { providerId: this.id }
              : {
                  providerId: this.id,
                  code: "provider_process_exit",
                  exitCode: code,
                },
        });
      }
    } catch (error) {
      this.push(state, {
        type: "agent.error",
        sessionId: state.session.id,
        taskId: request.taskId,
        correlationId: request.correlationId,
        payload: {
          providerId: this.id,
          code: "provider_process_error",
          message: error instanceof Error ? error.message : String(error),
        },
      });
    } finally {
      state.process = undefined;
      this.wakeWaiters(state);
    }
  }
}
