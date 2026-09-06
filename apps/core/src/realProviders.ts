import { randomUUID } from "node:crypto";
import {
  ClaudeCodeCliProvider,
  CodexCliProvider,
  type AgentEventDraft,
  type AgentMcpServer,
  type AgentProvider,
  type AgentProviderCapabilities,
  type AgentProviderStatus,
  type AgentWorkspace,
} from "@totem/agents";
import {
  EVENT_SCHEMA,
  validateTotemEvent,
  type JsonValue,
  type NormalizedFailure,
  type TotemEvent,
} from "@totem/protocol";
import type { TaskStatus } from "@totem/tasks";
import type { TaskStore } from "@totem/storage";
import type { RuntimeEventHub } from "./events.js";

export interface StartProviderTaskInput {
  prompt: string;
  providerId: string;
  kind?: string;
  title?: string;
  workspace?: AgentWorkspace;
  mcpServers?: AgentMcpServer[];
}

export interface ProviderSnapshot {
  id: string;
  status: AgentProviderStatus;
  capabilities: AgentProviderCapabilities;
}

export interface RealProviderCoordinatorOptions {
  taskStore: TaskStore;
  hub: RuntimeEventHub;
  providers?: AgentProvider<AgentEventDraft>[];
  now?: () => Date;
  newId?: (prefix: string) => string;
  logger?: {
    error: (details: Record<string, unknown>, message: string) => void;
  };
}

interface ActiveTask {
  provider: AgentProvider<AgentEventDraft>;
  providerSessionId: string;
  durableSessionId: string;
}

const TERMINAL_STATUSES = new Set<TaskStatus>([
  "succeeded",
  "failed",
  "cancelled",
]);

export class RealProviderCoordinator {
  readonly #taskStore: TaskStore;
  readonly #hub: RuntimeEventHub;
  readonly #providers = new Map<string, AgentProvider<AgentEventDraft>>();
  readonly #now: () => Date;
  readonly #newId: (prefix: string) => string;
  readonly #logger: RealProviderCoordinatorOptions["logger"];
  readonly #active = new Map<string, ActiveTask>();
  readonly #running = new Map<string, Promise<void>>();

  constructor(options: RealProviderCoordinatorOptions) {
    this.#taskStore = options.taskStore;
    this.#hub = options.hub;
    this.#now = options.now ?? (() => new Date());
    this.#newId =
      options.newId ?? ((prefix: string) => `${prefix}_${randomUUID()}`);
    this.#logger = options.logger;

    for (const provider of options.providers ?? [
      new CodexCliProvider(),
      new ClaudeCodeCliProvider(),
    ]) {
      if (this.#providers.has(provider.id)) {
        throw new Error(`Duplicate real agent provider '${provider.id}'`);
      }
      this.#providers.set(provider.id, provider);
    }
  }

  listProviderIds(): string[] {
    return [...this.#providers.keys()];
  }

  async providerSnapshots(): Promise<ProviderSnapshot[]> {
    return Promise.all(
      [...this.#providers.values()].map(async (provider) => ({
        id: provider.id,
        status: await provider.getStatus(),
        capabilities: await provider.probeCapabilities(),
      })),
    );
  }

  async startTask(input: StartProviderTaskInput): Promise<{
    taskId: string;
    sessionId: string;
    providerId: string;
    status: TaskStatus;
  }> {
    const prompt = input.prompt.trim();
    if (!prompt) {
      throw new RealProviderError(
        "prompt_required",
        "prompt must not be empty",
      );
    }

    const provider = this.#providers.get(input.providerId);
    if (!provider) {
      throw new RealProviderError(
        "provider_not_found",
        `Provider '${input.providerId}' is not registered`,
      );
    }

    const providerStatus = await provider.getStatus();
    if (!providerStatus.available) {
      throw new RealProviderError(
        "provider_unavailable",
        providerStatus.detail || `Provider '${provider.id}' is unavailable`,
      );
    }

    const providerSession = await provider.startSession({
      ...(input.workspace ? { workspace: input.workspace } : {}),
      ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
    });
    const durableSessionId = this.#newId("sess");
    const taskId = this.#newId("task");
    const correlationId = this.#newId("corr");
    const timestamp = this.#timestamp();
    const title =
      input.title?.trim() ||
      (prompt.length > 60 ? `${prompt.slice(0, 57)}...` : prompt);
    const kind = input.kind?.trim() || "agent";

    await this.#taskStore.createSession({
      id: durableSessionId,
      providerId: provider.id,
      providerSessionRef: providerSession.id,
      at: timestamp,
    });

    const created = this.#event({
      type: "task.created",
      taskId,
      sessionId: durableSessionId,
      correlationId,
      source: { kind: "core", id: "core" },
      payload: {
        kind,
        title,
        prompt,
        providerId: provider.id,
        ...(input.workspace ? { workspace: input.workspace } : {}),
        mcpServerIds: (input.mcpServers ?? []).map((server) => server.id),
      },
    });
    await this.#taskStore.createTask(
      {
        id: taskId,
        kind,
        title,
        sessionId: durableSessionId,
        providerId: provider.id,
        correlationId,
      },
      created,
    );
    this.#hub.publish(created);

    const started = this.#event({
      type: "task.started",
      taskId,
      sessionId: durableSessionId,
      correlationId,
      source: { kind: "core", id: "agent-orchestrator" },
      payload: { providerId: provider.id },
    });
    await this.#taskStore.transitionTask(taskId, "running", started);
    this.#hub.publish(started);

    const active: ActiveTask = {
      provider,
      providerSessionId: providerSession.id,
      durableSessionId,
    };
    this.#active.set(taskId, active);

    const iterator = provider
      .streamEvents(providerSession.id)
      [Symbol.asyncIterator]();
    await provider.sendMessage(providerSession.id, {
      content: prompt,
      taskId,
      correlationId,
    });

    const run = this.#consume(iterator, active, taskId, correlationId).catch(
      (error: unknown) => {
        this.#logger?.error(
          { event: "provider_task.consume_failed", taskId, err: error },
          "Real provider task event consumption failed",
        );
      },
    );
    this.#running.set(taskId, run);
    void run.finally(() => {
      if (this.#running.get(taskId) === run) this.#running.delete(taskId);
    });

    return {
      taskId,
      sessionId: durableSessionId,
      providerId: provider.id,
      status: "running",
    };
  }

  async interruptTask(taskId: string): Promise<void> {
    const active = this.#active.get(taskId);
    if (!active) {
      throw new RealProviderError(
        "task_not_active",
        `Task '${taskId}' has no active real provider session`,
      );
    }
    await active.provider.interrupt(active.providerSessionId);
  }

  async waitForTask(taskId: string): Promise<void> {
    await this.#running.get(taskId);
  }

  #timestamp(): string {
    return this.#now().toISOString();
  }

  #event(draft: {
    type: string;
    taskId?: string;
    sessionId?: string;
    correlationId?: string;
    payload: unknown;
    source: TotemEvent["source"];
  }): TotemEvent {
    return validateTotemEvent({
      schema: EVENT_SCHEMA,
      id: this.#newId("evt"),
      type: draft.type,
      occurredAt: this.#timestamp(),
      source: draft.source,
      ...(draft.taskId ? { taskId: draft.taskId } : {}),
      ...(draft.sessionId ? { sessionId: draft.sessionId } : {}),
      ...(draft.correlationId ? { correlationId: draft.correlationId } : {}),
      payload: draft.payload ?? {},
    });
  }

  #providerEvent(
    draft: AgentEventDraft,
    taskId: string,
    durableSessionId: string,
    correlationId: string,
  ): TotemEvent {
    return this.#event({
      type: draft.type,
      taskId,
      sessionId: durableSessionId,
      correlationId: draft.correlationId ?? correlationId,
      source: {
        kind: "provider",
        id: this.#active.get(taskId)?.provider.id ?? "agent",
      },
      payload: draft.payload,
    });
  }

  async #consume(
    iterator: AsyncIterator<AgentEventDraft>,
    active: ActiveTask,
    taskId: string,
    correlationId: string,
  ): Promise<void> {
    let lastText: string | undefined;
    try {
      while (true) {
        const { done, value } = await iterator.next();
        if (done || !value) break;

        const event = this.#providerEvent(
          value,
          taskId,
          active.durableSessionId,
          correlationId,
        );
        await this.#taskStore.appendTaskEvent(taskId, event);
        this.#hub.publish(event);

        const payload = (value.payload ?? {}) as Record<string, unknown>;
        if (typeof payload.text === "string" && payload.text.trim()) {
          lastText = payload.text;
        }
        if (typeof payload.nativeSessionId === "string") {
          await this.#taskStore.updateSessionStatus(
            active.durableSessionId,
            "active",
            this.#timestamp(),
            payload.nativeSessionId,
          );
        }

        if (value.type === "agent.completed") {
          await this.#succeed(
            taskId,
            active.durableSessionId,
            correlationId,
            lastText,
          );
          break;
        }
        if (value.type === "agent.error") {
          await this.#fail(
            taskId,
            active.durableSessionId,
            correlationId,
            payload,
          );
          break;
        }
        if (value.type === "agent.interrupted") {
          await this.#cancel(taskId, active.durableSessionId, correlationId);
          break;
        }
      }
    } finally {
      this.#active.delete(taskId);
      try {
        await active.provider.terminate(active.providerSessionId);
      } catch {
        // best effort
      }
      try {
        const task = await this.#taskStore.getTask(taskId);
        const status = task?.status === "failed" ? "failed" : "closed";
        await this.#taskStore.updateSessionStatus(
          active.durableSessionId,
          status,
          this.#timestamp(),
        );
      } catch {
        // best effort
      }
    }
  }

  async #succeed(
    taskId: string,
    sessionId: string,
    correlationId: string,
    text: string | undefined,
  ): Promise<void> {
    const task = await this.#taskStore.getTask(taskId);
    if (!task || TERMINAL_STATUSES.has(task.status)) return;
    const result: JsonValue = text ? { text } : { providerCompleted: true };
    const event = this.#event({
      type: "task.succeeded",
      taskId,
      sessionId,
      correlationId,
      source: { kind: "core", id: "agent-orchestrator" },
      payload: { result },
    });
    await this.#taskStore.transitionTask(taskId, "succeeded", event, {
      result,
    });
    this.#hub.publish(event);
  }

  async #fail(
    taskId: string,
    sessionId: string,
    correlationId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const task = await this.#taskStore.getTask(taskId);
    if (!task || TERMINAL_STATUSES.has(task.status)) return;
    const failure: NormalizedFailure = {
      code:
        typeof payload.code === "string" ? payload.code : "provider_failure",
      message:
        typeof payload.message === "string"
          ? payload.message
          : `Provider '${task.providerId ?? "unknown"}' failed`,
      retryable: false,
    };
    const event = this.#event({
      type: "task.failed",
      taskId,
      sessionId,
      correlationId,
      source: { kind: "core", id: "agent-orchestrator" },
      payload: { failure },
    });
    await this.#taskStore.transitionTask(taskId, "failed", event, { failure });
    this.#hub.publish(event);
  }

  async #cancel(
    taskId: string,
    sessionId: string,
    correlationId: string,
  ): Promise<void> {
    const task = await this.#taskStore.getTask(taskId);
    if (!task || TERMINAL_STATUSES.has(task.status)) return;
    if (task.status !== "cancelling") {
      const cancelling = this.#event({
        type: "task.cancelling",
        taskId,
        sessionId,
        correlationId,
        source: { kind: "core", id: "agent-orchestrator" },
        payload: {},
      });
      await this.#taskStore.transitionTask(taskId, "cancelling", cancelling);
      this.#hub.publish(cancelling);
    }
    const cancelled = this.#event({
      type: "task.cancelled",
      taskId,
      sessionId,
      correlationId,
      source: { kind: "core", id: "agent-orchestrator" },
      payload: { reason: "provider_interrupted" },
    });
    await this.#taskStore.transitionTask(taskId, "cancelled", cancelled);
    this.#hub.publish(cancelled);
  }
}

export class RealProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RealProviderError";
  }
}
