export type AgentProviderSessionStatus =
  | "active"
  | "interrupted"
  | "terminated";

export interface AgentProviderCapabilities {
  streaming: boolean;
  resume: boolean;
  interrupt: boolean;
  workspaces: boolean;
  mcp: boolean;
}

export interface AgentWorkspace {
  path: string;
  access: "read-only" | "read-write";
}

export interface AgentMcpServer {
  id: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface AgentSession {
  id: string;
  providerId: string;
  status: AgentProviderSessionStatus;
  workspace?: AgentWorkspace;
  mcpServers: AgentMcpServer[];
}

export interface StartSessionOptions {
  workspace?: AgentWorkspace;
  mcpServers?: AgentMcpServer[];
}

export interface AgentMessageRequest {
  content: string;
  taskId: string;
  correlationId?: string;
}

export interface AgentEventDraft {
  type: string;
  sessionId: string;
  taskId?: string;
  correlationId?: string;
  payload: unknown;
}

export type AgentEventFactory<TEvent> = (draft: AgentEventDraft) => TEvent;

export interface AgentProviderStatus {
  id: string;
  available: boolean;
  detail?: string;
}

export interface AgentProvider<TEvent> {
  readonly id: string;
  probeCapabilities(): Promise<AgentProviderCapabilities>;
  getStatus(): Promise<AgentProviderStatus>;
  startSession(options?: StartSessionOptions): Promise<AgentSession>;
  resumeSession(sessionId: string): Promise<AgentSession>;
  sendMessage(sessionId: string, request: AgentMessageRequest): Promise<void>;
  streamEvents(sessionId: string): AsyncIterable<TEvent>;
  interrupt(sessionId: string): Promise<void>;
  terminate(sessionId: string): Promise<void>;
  attachWorkspace(sessionId: string, workspace: AgentWorkspace): Promise<void>;
  registerMcpServers(
    sessionId: string,
    servers: AgentMcpServer[],
  ): Promise<void>;
}

export class AgentProviderError extends Error {
  readonly code: string;
  readonly providerId: string;
  readonly sessionId?: string;

  constructor(
    providerId: string,
    code: string,
    message: string,
    sessionId?: string,
  ) {
    super(message);
    this.name = "AgentProviderError";
    this.providerId = providerId;
    this.code = code;
    this.sessionId = sessionId;
  }
}

export class AgentProviderRegistry<TEvent> {
  readonly #providers = new Map<string, AgentProvider<TEvent>>();

  register(provider: AgentProvider<TEvent>): void {
    if (this.#providers.has(provider.id)) {
      throw new AgentProviderError(
        provider.id,
        "provider_duplicate",
        `Agent provider '${provider.id}' is already registered`,
      );
    }
    this.#providers.set(provider.id, provider);
  }

  get(providerId: string): AgentProvider<TEvent> {
    const provider = this.#providers.get(providerId);
    if (!provider) {
      throw new AgentProviderError(
        providerId,
        "provider_not_found",
        `Agent provider '${providerId}' is not registered`,
      );
    }
    return provider;
  }

  list(): AgentProvider<TEvent>[] {
    return [...this.#providers.values()];
  }
}

export { MockAgentProvider, type MockAgentScenario } from "./mock.js";
export {
  CliAgentProvider,
  nodeProcessRunner,
  type CliSessionState,
  type ProcessRunner,
  type RunningProcess,
  type SpawnSpec,
} from "./cli.js";
export { CodexCliProvider } from "./codex.js";
export { ClaudeCodeCliProvider } from "./claude.js";
