import {
  AgentProviderError,
  type AgentEventFactory,
  type AgentMcpServer,
  type AgentMessageRequest,
  type AgentProvider,
  type AgentProviderCapabilities,
  type AgentProviderStatus,
  type AgentSession,
  type AgentWorkspace,
  type StartSessionOptions,
} from "./index.js";

interface QueueWaiter<T> {
  resolve: (result: IteratorResult<T>) => void;
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  readonly #items: T[] = [];
  readonly #waiters: QueueWaiter<T>[] = [];
  #closed = false;

  push(item: T): void {
    if (this.#closed) throw new Error("event queue is closed");
    const waiter = this.#waiters.shift();
    if (waiter) {
      waiter.resolve({ done: false, value: item });
      return;
    }
    this.#items.push(item);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) {
      waiter.resolve({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async () => {
        const item = this.#items.shift();
        if (item !== undefined) return { done: false, value: item };
        if (this.#closed) return { done: true, value: undefined };

        return new Promise<IteratorResult<T>>((resolve) => {
          this.#waiters.push({ resolve });
        });
      },
    };
  }
}

interface MockSessionState<TEvent> {
  session: AgentSession;
  queue: AsyncEventQueue<TEvent>;
  pendingTaskId?: string;
  pendingCorrelationId?: string;
}

export interface MockAgentProviderOptions<TEvent> {
  createEvent: AgentEventFactory<TEvent>;
  id?: string;
}

function cloneWorkspace(workspace: AgentWorkspace | undefined) {
  return workspace ? { ...workspace } : undefined;
}

function cloneMcpServers(servers: AgentMcpServer[]): AgentMcpServer[] {
  return servers.map((server) => ({
    ...server,
    ...(server.args ? { args: [...server.args] } : {}),
    ...(server.env ? { env: { ...server.env } } : {}),
  }));
}

function cloneSession(session: AgentSession): AgentSession {
  return {
    ...session,
    ...(session.workspace ? { workspace: cloneWorkspace(session.workspace) } : {}),
    mcpServers: cloneMcpServers(session.mcpServers),
  };
}

export class MockAgentProvider<TEvent> implements AgentProvider<TEvent> {
  readonly id: string;
  readonly #createEvent: AgentEventFactory<TEvent>;
  readonly #sessions = new Map<string, MockSessionState<TEvent>>();
  #nextSession = 1;

  constructor(options: MockAgentProviderOptions<TEvent>) {
    this.id = options.id ?? "mock";
    this.#createEvent = options.createEvent;
  }

  async probeCapabilities(): Promise<AgentProviderCapabilities> {
    return {
      streaming: true,
      resume: true,
      interrupt: true,
      workspaces: true,
      mcp: true,
    };
  }

  async getStatus(): Promise<AgentProviderStatus> {
    return {
      id: this.id,
      available: true,
      detail: "deterministic mock provider",
    };
  }

  async startSession(options: StartSessionOptions = {}): Promise<AgentSession> {
    const session: AgentSession = {
      id: `mock-session-${this.#nextSession++}`,
      providerId: this.id,
      status: "active",
      ...(options.workspace
        ? { workspace: cloneWorkspace(options.workspace) }
        : {}),
      mcpServers: cloneMcpServers(options.mcpServers ?? []),
    };
    const state: MockSessionState<TEvent> = {
      session,
      queue: new AsyncEventQueue<TEvent>(),
    };
    this.#sessions.set(session.id, state);
    this.#emit(state, "agent.session_created", {
      providerId: this.id,
      capabilities: await this.probeCapabilities(),
    });
    return cloneSession(session);
  }

  async resumeSession(sessionId: string): Promise<AgentSession> {
    const state = this.#getState(sessionId);
    if (state.session.status === "terminated") {
      throw this.#error(
        "session_terminated",
        `Session '${sessionId}' has been terminated`,
        sessionId,
      );
    }
    state.session.status = "active";
    this.#emit(state, "agent.session_resumed", { providerId: this.id });
    return cloneSession(state.session);
  }

  async sendMessage(
    sessionId: string,
    request: AgentMessageRequest,
  ): Promise<void> {
    const state = this.#requireActive(sessionId);
    if (request.content.trim() === "") {
      throw this.#error(
        "message_empty",
        "Agent message content must not be empty",
        sessionId,
      );
    }
    if (request.taskId.trim() === "") {
      throw this.#error(
        "task_id_empty",
        "Agent message taskId must not be empty",
        sessionId,
      );
    }
    if (state.pendingTaskId) {
      throw this.#error(
        "session_busy",
        `Session '${sessionId}' already has a waiting mock task`,
        sessionId,
      );
    }

    const context = {
      taskId: request.taskId,
      correlationId: request.correlationId,
    };
    this.#emit(
      state,
      "agent.message",
      { role: "user", content: request.content },
      context,
    );
    this.#emit(state, "task.started", {}, context);
    this.#emit(
      state,
      "agent.progress",
      { message: "Mock provider accepted the request" },
      context,
    );
    this.#emit(
      state,
      "task.progress",
      { message: "Running deterministic mock step", progress: 0.5 },
      context,
    );

    const scenario = request.scenario ?? "success";
    if (scenario === "wait") {
      state.pendingTaskId = request.taskId;
      state.pendingCorrelationId = request.correlationId;
      return;
    }

    if (scenario === "failure") {
      this.#emit(
        state,
        "agent.error",
        {
          error: {
            code: "mock_failure",
            message: "Deterministic mock failure",
            retryable: false,
          },
        },
        context,
      );
      this.#emit(
        state,
        "task.failed",
        {
          failure: {
            code: "mock_failure",
            message: "Deterministic mock failure",
            retryable: false,
          },
        },
        context,
      );
      return;
    }

    const text = `Mock response: ${request.content}`;
    this.#emit(
      state,
      "agent.message",
      { role: "assistant", content: text },
      context,
    );
    this.#emit(state, "task.succeeded", { result: { text } }, context);
  }

  streamEvents(sessionId: string): AsyncIterable<TEvent> {
    return this.#getState(sessionId).queue;
  }

  async interrupt(sessionId: string): Promise<void> {
    const state = this.#getState(sessionId);
    if (state.session.status === "terminated") {
      throw this.#error(
        "session_terminated",
        `Session '${sessionId}' has been terminated`,
        sessionId,
      );
    }

    const taskId = state.pendingTaskId;
    const correlationId = state.pendingCorrelationId;
    state.session.status = "interrupted";
    this.#emit(
      state,
      "agent.interrupted",
      { reason: "interrupt_requested" },
      taskId ? { taskId, correlationId } : undefined,
    );

    if (taskId) {
      const context = { taskId, correlationId };
      this.#emit(state, "task.cancelling", {}, context);
      this.#emit(state, "task.cancelled", { reason: "interrupted" }, context);
      state.pendingTaskId = undefined;
      state.pendingCorrelationId = undefined;
    }
  }

  async terminate(sessionId: string): Promise<void> {
    const state = this.#getState(sessionId);
    if (state.session.status === "terminated") return;

    if (state.pendingTaskId) await this.interrupt(sessionId);
    state.session.status = "terminated";
    state.queue.close();
  }

  async attachWorkspace(
    sessionId: string,
    workspace: AgentWorkspace,
  ): Promise<void> {
    const state = this.#requireActive(sessionId);
    if (workspace.path.trim() === "") {
      throw this.#error(
        "workspace_path_empty",
        "Workspace path must not be empty",
        sessionId,
      );
    }
    state.session.workspace = cloneWorkspace(workspace);
  }

  async registerMcpServers(
    sessionId: string,
    servers: AgentMcpServer[],
  ): Promise<void> {
    const state = this.#requireActive(sessionId);
    const ids = new Set<string>();
    for (const server of servers) {
      if (server.id.trim() === "" || server.command.trim() === "") {
        throw this.#error(
          "mcp_server_invalid",
          "MCP server id and command must not be empty",
          sessionId,
        );
      }
      if (ids.has(server.id)) {
        throw this.#error(
          "mcp_server_duplicate",
          `MCP server '${server.id}' is duplicated`,
          sessionId,
        );
      }
      ids.add(server.id);
    }
    state.session.mcpServers = cloneMcpServers(servers);
  }

  #getState(sessionId: string): MockSessionState<TEvent> {
    const state = this.#sessions.get(sessionId);
    if (!state) {
      throw this.#error(
        "session_not_found",
        `Session '${sessionId}' does not exist`,
        sessionId,
      );
    }
    return state;
  }

  #requireActive(sessionId: string): MockSessionState<TEvent> {
    const state = this.#getState(sessionId);
    if (state.session.status !== "active") {
      throw this.#error(
        "session_not_active",
        `Session '${sessionId}' is ${state.session.status}`,
        sessionId,
      );
    }
    return state;
  }

  #emit(
    state: MockSessionState<TEvent>,
    type: string,
    payload: unknown,
    context?: { taskId?: string; correlationId?: string },
  ): void {
    state.queue.push(
      this.#createEvent({
        type,
        sessionId: state.session.id,
        ...(context?.taskId ? { taskId: context.taskId } : {}),
        ...(context?.correlationId
          ? { correlationId: context.correlationId }
          : {}),
        payload,
      }),
    );
  }

  #error(code: string, message: string, sessionId?: string) {
    return new AgentProviderError(this.id, code, message, sessionId);
  }
}
