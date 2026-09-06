import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface ExtensionSettingsStore {
  get(extensionId: string): Promise<Record<string, unknown>>;
  set(extensionId: string, key: string, value: unknown): Promise<void>;
}

export interface ExtensionSecretProvider {
  get(extensionId: string, secretId: string): Promise<string | undefined>;
}

interface PersistedSettings {
  version: 1;
  extensions: Record<string, Record<string, unknown>>;
}

const EMPTY_SETTINGS: PersistedSettings = { version: 1, extensions: {} };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSettings(raw: string): PersistedSettings {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.extensions)) {
    throw new Error("Invalid extension settings file");
  }

  const extensions: Record<string, Record<string, unknown>> = {};
  for (const [extensionId, values] of Object.entries(parsed.extensions)) {
    if (!isRecord(values)) throw new Error("Invalid extension settings file");
    extensions[extensionId] = structuredClone(values);
  }
  return { version: 1, extensions };
}

/**
 * Small durable settings store used by the extension runtime. Writes are
 * replace-then-rename so a process crash cannot leave a partially-written JSON
 * document. Secret values deliberately do not share this store.
 */
export class JsonExtensionSettingsStore implements ExtensionSettingsStore {
  readonly #filename: string;
  #writeQueue = Promise.resolve();

  constructor(filename: string) {
    this.#filename = filename;
  }

  async get(extensionId: string): Promise<Record<string, unknown>> {
    const state = await this.#read();
    return structuredClone(state.extensions[extensionId] ?? {});
  }

  async set(extensionId: string, key: string, value: unknown): Promise<void> {
    const operation = this.#writeQueue.then(async () => {
      const state = await this.#read();
      state.extensions[extensionId] ??= {};
      state.extensions[extensionId][key] = structuredClone(value);
      await mkdir(dirname(this.#filename), { recursive: true });
      const temporary = `${this.#filename}.tmp`;
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      await rename(temporary, this.#filename);
    });
    this.#writeQueue = operation.catch(() => undefined);
    await operation;
  }

  async #read(): Promise<PersistedSettings> {
    try {
      return parseSettings(await readFile(this.#filename, "utf8"));
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return structuredClone(EMPTY_SETTINGS);
      }
      throw error;
    }
  }
}

/** Secret provider whose values remain process-local and are never serialized. */
export class InMemoryExtensionSecretProvider implements ExtensionSecretProvider {
  readonly #values: Readonly<Record<string, Readonly<Record<string, string>>>>;

  constructor(
    values: Readonly<Record<string, Readonly<Record<string, string>>>> = {},
  ) {
    this.#values = values;
  }

  async get(extensionId: string, secretId: string): Promise<string | undefined> {
    return this.#values[extensionId]?.[secretId];
  }
}
