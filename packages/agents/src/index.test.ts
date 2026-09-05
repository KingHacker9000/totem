import { describe, expect, it } from "vitest";
import {
  EVENT_SCHEMA,
  type TotemEvent,
  validateTotemEvent,
} from "../../protocol/src/index.js";
import {
  AgentProviderError,
  AgentProviderRegistry,
  type AgentEventDraft,
  MockAgentProvider,
} from "./index.js";

function normalizedFactory() {
  let sequence = 0;
  return (draft: AgentEventDraft): TotemEvent =>
    validateTotemEvent({
      schema: EVENT_SCHEMA,
      id: `mock-event-${String(++sequence).padStart(4, "0")}`,
      type: draft.type,
      occurredAt: "2026-09-05T23:20:00.000Z",
      source: { kind: "provider", id: "mock" },
      sessionId: draft.sessionId,
      ...(draft.taskId ? { taskId: draft.taskId } : {}),
      ...(draft.correlationId ? { correlationId: draft.correlationId } : {}),
      payload: draft.payload,
    });
}

async function take<T>(iterator: AsyncIterator<T>, count: number): Promise<T[]> {
  const values: T[] = [];
  for (let index = 0; index < count; index += 1) {
    const result = await iterator.next();
    if (result.done) break;
    values.push(result.value);
  }
  return values;
}

describe("AgentProviderRegistry", () => {
  it("registers providers without provider-specific core assumptions", () => {
    const provider = new MockAgentProvider<TotemEvent>({
      createEvent: normalizedFactory(),
    });
    const registry = new AgentProviderRegistry<TotemEvent>();

    registry.register(provider);
    expect(registry.get("mock")).toBe(provider);
    expect(registry.list()).toEqual([provider]);

    expect(() => registry.register(provider)).toThrow(/already registered/);
    expect(() => registry.get("missing")).toThrow(AgentProviderError);
  });
});

describe("MockAgentProvider", () => {
  it("reports deterministic capabilities and supports workspace/MCP metadata", async () => {
    const provider = new MockAgentProvider<TotemEvent>({
      createEvent: normalizedFactory(),
    });

    expect(await provider.probeCapabilities()).toEqual({
      streaming: true,
      resume: true,
      interrupt: true,
      workspaces: true,
      mcp: true,
    });
    expect(await provider.getStatus()).toMatchObject({
      id: "mock",
      available: true,
    });

    const session = await provider.startSession({
      workspace: { path: "C:/Dev/Totem", access: "read-write" },
    });
    await provider.registerMcpServers(session.id, [
      { id: "weather", command: "weather-mcp", args: ["--stdio"] },
    ]);
    await provider.attachWorkspace(session.id, {
      path: "C:/Dev/Totem/project",
      access: "read-only",
    });

    const resumed = await provider.resumeSession(session.id);
    expect(resumed.workspace).toEqual({
      path: "C:/Dev/Totem/project",
      access: "read-only",
    });
    expect(resumed.mcpServers).toEqual([
      { id: "weather", command: "weather-mcp", args: ["--stdio"] },
    ]);
  });

  it("streams a normalized successful task flow", async () => {
    const provider = new MockAgentProvider<TotemEvent>({
      createEvent: normalizedFactory(),
    });
    const session = await provider.startSession();
    const iterator = provider.streamEvents(session.id)[Symbol.asyncIterator]();

    await provider.sendMessage(session.id, {
      content: "hello",
      taskId: "task-success",
      correlationId: "corr-success",
    });

    const events = await take(iterator, 7);
    expect(events.map((event) => event.type)).toEqual([
      "agent.session_created",
      "agent.message",
      "task.started",
      "agent.progress",
      "task.progress",
      "agent.message",
      "task.succeeded",
    ]);
    expect(events.every((event) => event.schema === EVENT_SCHEMA)).toBe(true);
    expect(events.at(-1)?.payload).toEqual({
      result: { text: "Mock response: hello" },
    });
  });

  it("represents deterministic failure without provider-native event leakage", async () => {
    const provider = new MockAgentProvider<TotemEvent>({
      createEvent: normalizedFactory(),
    });
    const session = await provider.startSession();
    const iterator = provider.streamEvents(session.id)[Symbol.asyncIterator]();

    await provider.sendMessage(session.id, {
      content: "fail please",
      taskId: "task-failure",
      scenario: "failure",
    });

    const events = await take(iterator, 7);
    expect(events.map((event) => event.type)).toEqual([
      "agent.session_created",
      "agent.message",
      "task.started",
      "agent.progress",
      "task.progress",
      "agent.error",
      "task.failed",
    ]);
    expect(events.at(-1)?.payload).toEqual({
      failure: {
        code: "mock_failure",
        message: "Deterministic mock failure",
        retryable: false,
      },
    });
  });

  it("interrupts a waiting task through normalized cancellation events", async () => {
    const provider = new MockAgentProvider<TotemEvent>({
      createEvent: normalizedFactory(),
    });
    const session = await provider.startSession();
    const iterator = provider.streamEvents(session.id)[Symbol.asyncIterator]();

    await provider.sendMessage(session.id, {
      content: "wait",
      taskId: "task-wait",
      correlationId: "corr-wait",
      scenario: "wait",
    });
    await provider.interrupt(session.id);

    const events = await take(iterator, 8);
    expect(events.map((event) => event.type)).toEqual([
      "agent.session_created",
      "agent.message",
      "task.started",
      "agent.progress",
      "task.progress",
      "agent.interrupted",
      "task.cancelling",
      "task.cancelled",
    ]);
    expect(events.at(-1)?.taskId).toBe("task-wait");

    await expect(
      provider.sendMessage(session.id, {
        content: "cannot run while interrupted",
        taskId: "task-next",
      }),
    ).rejects.toThrow(/interrupted/);

    await provider.resumeSession(session.id);
    await provider.sendMessage(session.id, {
      content: "resumed",
      taskId: "task-next",
    });
  });

  it("closes the stream on termination and rejects invalid session operations", async () => {
    const provider = new MockAgentProvider<TotemEvent>({
      createEvent: normalizedFactory(),
    });
    const session = await provider.startSession();
    const iterator = provider.streamEvents(session.id)[Symbol.asyncIterator]();

    await provider.terminate(session.id);
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(first.value.type).toBe("agent.session_created");
    expect((await iterator.next()).done).toBe(true);

    await expect(provider.resumeSession(session.id)).rejects.toMatchObject({
      code: "session_terminated",
    });
    await expect(provider.resumeSession("missing")).rejects.toMatchObject({
      code: "session_not_found",
    });
  });
});
