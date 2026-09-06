import { randomUUID } from "node:crypto";
import {
  AgentProviderRegistry,
  MockAgentProvider,
  type AgentEventDraft,
  type MockAgentScenario,
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

export interface StartMockTaskInput {
  prompt: string;
  kind?: string;
  title?: string;
  scenario?: MockAgentScenario;
}

export interface OrchestratorOptions {
  taskStore: TaskStore;
  hub: RuntimeEventHub;
  providerId?: string;
  /** Overridable for deterministic tests. */
  now?: () => Date;
  newId?: (prefix: string) => string;
  logger?: {
    error: (details: Record<string, unknown>, message: string) => void;
  };
}

const LIFECYCLE_STATUS_BY_EVENT: Readonly<Record<string, TaskStatus>> = {
  "task.started": "running",
  "task.resumed": "running",
  "task.waiting_for_input": "waiting_for_input",
  "task.cancelling": "cancelling",
  "task.cancelled": "cancelled",
  "task.succeeded": "succeeded",
  "task.failed": "failed",
};

const TERMINAL_STATUSES = new Set<TaskStatus>([
  "succeeded",
  "failed",
  "cancelled",
]);

/**
 * Wires the deterministic {@link MockAgentProvider} into durable task storage and
 * the runtime event hub so a mocked task can be started from an input surface,
 * streamed to browser clients, and replayed from persistence after a reconnect.
 */
export class TaskOrchestrator {
  readonly #taskStore: TaskStore;
  readonly #hub: RuntimeEventHub;
  readonly #providerId: string;
  readonly #registry = new AgentProviderRegistry<TotemEvent>();
  readonly #provider: MockAgentProvider<TotemEvent>;
  readonly #now: () => Date;
  readonly #newId: (prefix: string) => string;
  readonly #logger: OrchestratorOptions["logger"];
  readonly #running = new Map<string, Promise<void>>();
  readonly #sessionByTask = new Map<string, string>();

  constructor(options: OrchestratorOptions) {
    this.#taskStore = options.taskStore;
    this.#hub = options.hub;
    this.#providerId = options.providerId ?? "mock";
    this.#now = options.now ?? (() => new Date());
    this.#newId =
      options.newId ?? ((prefix: string) => `${prefix}_${randomUUID()}`);
    this.#logger = options.logger;

    this.#provider = new MockAgentProvider<TotemEvent>({
      id: this.#providerId,
      createEvent: (draft: AgentEventDraft): TotemEvent => this.#toEvent(draft),
    });
    this.#registry.register(this.#provider);
  }

  get providerId(): string {
    return this.#providerId;
  }

  #timestamp(): string {
    return this.#now().toISOString();
  }

  #toEvent(draft: {
    type: string;
    sessionId?: string;
    taskId?: string;
    correlationId?: string;
    payload: unknown;
    source?: TotemEvent["source"];
  }): TotemEvent {
    return validateTotemEvent({
      schema: EVENT_SCHEMA,
      id: this.#newId("evt"),
      type: draft.type,
      occurredAt: this.#timestamp(),
      source: draft.source ?? { kind: "provider", id: this.#providerId },
      ...(draft.sessionId ? { sessionId: draft.sessionId } : {}),
      ...(draft.taskId ? { taskId: draft.taskId } : {}),
      ...(draft.correlationId ? { correlationId: draft.correlationId } : {}),
      payload: draft.payload ?? {},
    });
  }

  #publishDisplay(
    type: "display.scene_changed" | "display.led_changed",
    payload: Record<string, unknown>,
  ): void {
    this.#hub.publish(
      this.#toEvent({
        type,
        payload,
        source: { kind: "core", id: "display-runtime" },
      }),
    );
  }

  #reflectStatusOnDisplay(taskId: string, status: TaskStatus): void {
    if (status === "running") {
      this.#publishDisplay("display.scene_changed", {
        activeSceneId: "task-active",
        activeRequestId: `task:${taskId}`,
        priority: 40,
      });
      this.#publishDisplay("display.led_changed", {
        semantic: "attention",
        effect: "pulse",
        intensity: 0.85,
      });
      return;
    }

    if (!TERMINAL_STATUSES.has(status)) return;

    const led =
      status === "succeeded"
        ? { semantic: "success", effect: "solid", intensity: 0.7 }
        : status === "failed"
          ? { semantic: "error", effect: "pulse", intensity: 0.9 }
          : { semantic: "idle", effect: "breathe", intensity: 0.35 };
    this.#publishDisplay("display.led_changed", led);
    this.#publishDisplay("display.scene_changed", {
      activeSceneId: "ambient",
      activeRequestId: "ambient",
      priority: 0,
    });
  }

  async startMockTask(input: StartMockTaskInput): Promise<{
    taskId: string;
    sessionId: string;
    status: TaskStatus;
  }> {
    const prompt = input.prompt?.trim();
    if (!prompt) {
      throw new OrchestratorError(
        "prompt_required",
        "prompt must not be empty",
      );
    }

    const kind = input.kind?.trim() || "mock-agent";
    const title =
      input.title?.trim() ||
      (prompt.length > 60 ? `${prompt.slice(0, 57)}...` : prompt);
    const taskId = this.#newId("task");
    const correlationId = this.#newId("corr");

    // The provider mints its own session id, which is only unique within a
    // single provider instance (the deterministic mock restarts its counter on
    // every core start). Core owns the durable session identity and keeps the
    // provider's id as a reference, so restarting core cannot collide with a
    // persisted `agent_sessions` row.
    const providerSession = await this.#provider.startSession();
    const providerSessionId = providerSession.id;
    const agentSessionId = this.#newId("sess");
    await this.#taskStore.createSession({
      id: agentSessionId,
      providerId: this.#providerId,
      providerSessionRef: providerSessionId,
      at: this.#timestamp(),
    });

    // Drain the provider's session-created event onto the hub before the task
    // exists; it carries no taskId and is not part of durable task history.
    const iterator = this.#provider
      .streamEvents(providerSessionId)
      [Symbol.asyncIterator]();
    await this.#drainNonTaskEvents(iterator);

    const createdEvent = this.#toEvent({
      type: "task.created",
      taskId,
      sessionId: agentSessionId,
      correlationId,
      payload: { kind, title, prompt },
      source: { kind: "core", id: "core" },
    });
    await this.#taskStore.createTask(
      {
        id: taskId,
        kind,
        title,
        sessionId: agentSessionId,
        providerId: this.#providerId,
        correlationId,
      },
      createdEvent,
    );
    this.#hub.publish(createdEvent);
    this.#sessionByTask.set(taskId, providerSessionId);

    if (input.scenario && input.scenario !== "success") {
      this.#provider.scriptNext(providerSessionId, input.scenario);
    }
    await this.#provider.sendMessage(providerSessionId, {
      content: prompt,
      taskId,
      correlationId,
    });

    const run = this.#consume(
      iterator,
      providerSessionId,
      agentSessionId,
      taskId,
    ).catch((error: unknown) => {
      this.#logger?.error(
        { event: "task.consume_failed", taskId, err: error },
        "Mock task event consumption failed",
      );
    });
    this.#running.set(taskId, run);
    void run.finally(() => {
      if (this.#running.get(taskId) === run) this.#running.delete(taskId);
    });

    return { taskId, sessionId: agentSessionId, status: "queued" };
  }

  async interruptTask(taskId: string): Promise<void> {
    const sessionId = this.#sessionByTask.get(taskId);
    if (!sessionId) {
      throw new OrchestratorError(
        "task_not_active",
        `Task '${taskId}' has no active mock session`,
      );
    }
    await this.#provider.interrupt(sessionId);
  }

  /** Resolves once the background consumer for a task has finished. */
  async waitForTask(taskId: string): Promise<void> {
    await this.#running.get(taskId);
  }

  async #drainNonTaskEvents(
    iterator: AsyncIterator<TotemEvent>,
  ): Promise<void> {
    // The mock emits exactly one `agent.session_created` before any task work.
    const { done, value } = await iterator.next();
    if (done || !value) return;
    if (value.taskId) {
      // Unexpected, but do not lose the event.
      await this.#persistAndPublish(value, value.taskId);
      return;
    }
    this.#hub.publish(value);
  }

  async #consume(
    iterator: AsyncIterator<TotemEvent>,
    providerSessionId: string,
    agentSessionId: string,
    taskId: string,
  ): Promise<void> {
    try {
      while (true) {
        const { done, value } = await iterator.next();
        if (done || !value) break;

        const status = await this.#persistAndPublish(value, taskId);
        if (status && TERMINAL_STATUSES.has(status)) break;
      }
    } finally {
      this.#sessionByTask.delete(taskId);
      try {
        await this.#provider.terminate(providerSessionId);
      } catch {
        // best effort
      }
      try {
        await this.#taskStore.updateSessionStatus(
          agentSessionId,
          "closed",
          this.#timestamp(),
        );
      } catch {
        // best effort
      }
    }
  }

  async #persistAndPublish(
    event: TotemEvent,
    taskId: string,
  ): Promise<TaskStatus | undefined> {
    let resultingStatus: TaskStatus | undefined;
    const targetStatus = LIFECYCLE_STATUS_BY_EVENT[event.type];

    if (targetStatus) {
      const payload = (event.payload ?? {}) as {
        result?: JsonValue;
        failure?: NormalizedFailure;
      };
      const options: { result?: JsonValue; failure?: NormalizedFailure } = {};
      if (targetStatus === "succeeded" && payload.result !== undefined) {
        options.result = payload.result;
      }
      if (targetStatus === "failed") {
        options.failure = payload.failure ?? {
          code: "unknown_failure",
          message: "Task failed without a normalized failure payload",
          retryable: false,
        };
      }
      const record = await this.#taskStore.transitionTask(
        taskId,
        targetStatus,
        event,
        options,
      );
      resultingStatus = record.status;
    } else if (event.taskId === taskId) {
      await this.#taskStore.appendTaskEvent(taskId, event);
    }

    this.#hub.publish(event);
    if (resultingStatus) this.#reflectStatusOnDisplay(taskId, resultingStatus);
    return resultingStatus;
  }
}

export class OrchestratorError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OrchestratorError";
    this.code = code;
  }
}
