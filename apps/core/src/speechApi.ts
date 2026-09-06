import type { FastifyInstance } from "fastify";
import type { TotemSpeechConfig } from "./config.js";
import {
  decodePcm16Wav,
  encodePcm16Wav,
  PiperTextToSpeechAdapter,
  WhisperCppSpeechToTextAdapter,
} from "./speechAdapters.js";
import {
  EnergyVad,
  type SpeechAdapterStatus,
  type SpeechAudioChunk,
  type SpeechPlaybackSink,
  SpeechRuntime,
  SpeechRuntimeError,
  type SpeechTaskGateway,
  type SpeechTaskHandle,
  type SpeechToTextAdapter,
  type SpeechVoiceSelection,
  type TextToSpeechAdapter,
} from "./speechRuntime.js";

export interface SpeechServiceSnapshot {
  enabled: boolean;
  taskProviderId: string;
  vadThreshold: number;
  runtime: Awaited<ReturnType<SpeechRuntime["snapshot"]>>;
}

export interface SpeechService {
  snapshot(): Promise<SpeechServiceSnapshot>;
  submitText(prompt: string): Promise<SpeechTaskHandle>;
  submitWav(wav: Buffer): Promise<SpeechTaskHandle | undefined>;
  synthesize(text: string): Promise<Buffer>;
  bargeIn(): Promise<void>;
}

export interface ConfiguredSpeechServiceOptions {
  config: TotemSpeechConfig;
  tasks: SpeechTaskGateway;
  resolveVoice?: () =>
    | Promise<SpeechVoiceSelection | undefined>
    | SpeechVoiceSelection
    | undefined;
}

class DisabledSpeechToTextAdapter implements SpeechToTextAdapter {
  readonly id = "none";

  status(): SpeechAdapterStatus {
    return { available: false, reason: "stt_disabled" };
  }

  async transcribe(
    _audio: SpeechAudioChunk,
    _signal: AbortSignal,
  ): Promise<string> {
    throw new SpeechRuntimeError("stt_unavailable", "stt_disabled");
  }
}

class DisabledTextToSpeechAdapter implements TextToSpeechAdapter {
  readonly id = "none";

  status(): SpeechAdapterStatus {
    return { available: false, reason: "tts_disabled" };
  }

  synthesize(
    _text: string,
    _options: SpeechVoiceSelection,
    _signal: AbortSignal,
  ): AsyncIterable<SpeechAudioChunk> {
    return {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<SpeechAudioChunk>> {
            throw new SpeechRuntimeError("tts_unavailable", "tts_disabled");
          },
        };
      },
    };
  }
}

class ApiPlaybackSink implements SpeechPlaybackSink {
  async play(_chunk: SpeechAudioChunk, _signal: AbortSignal): Promise<void> {}
  async stop(): Promise<void> {}
}

export class ConfiguredSpeechService implements SpeechService {
  readonly #config: TotemSpeechConfig;
  readonly #tts: TextToSpeechAdapter;
  readonly #runtime: SpeechRuntime;

  constructor(options: ConfiguredSpeechServiceOptions) {
    this.#config = options.config;
    const stt = createStt(options.config);
    this.#tts = createTts(options.config);
    this.#runtime = new SpeechRuntime({
      tasks: options.tasks,
      vad: new EnergyVad(options.config.vadThreshold),
      stt,
      tts: this.#tts,
      playback: new ApiPlaybackSink(),
      ...(options.resolveVoice ? { resolveVoice: options.resolveVoice } : {}),
    });
  }

  async snapshot(): Promise<SpeechServiceSnapshot> {
    const runtime = await this.#runtime.snapshot();
    return {
      enabled: runtime.stt.available || runtime.tts.available,
      taskProviderId: this.#config.agentProviderId,
      vadThreshold: this.#config.vadThreshold,
      runtime,
    };
  }

  async submitText(prompt: string): Promise<SpeechTaskHandle> {
    return await this.#runtime.submitText(prompt);
  }

  async submitWav(wav: Buffer): Promise<SpeechTaskHandle | undefined> {
    return await this.#runtime.submitAudio(decodePcm16Wav(wav));
  }

  async synthesize(text: string): Promise<Buffer> {
    const normalized = text.trim();
    if (!normalized) {
      throw new SpeechRuntimeError(
        "prompt_required",
        "Speech synthesis text must not be empty",
      );
    }

    const voice = (await this.#runtime.snapshot()).voice ?? {};
    const controller = new AbortController();
    const chunks: SpeechAudioChunk[] = [];
    for await (const chunk of this.#tts.synthesize(
      normalized,
      voice,
      controller.signal,
    )) {
      chunks.push(chunk);
    }
    if (chunks.length === 0) {
      throw new SpeechRuntimeError(
        "tts_empty_output",
        "The configured TTS adapter produced no audio",
      );
    }
    return encodePcm16Wav(concatenateAudio(chunks));
  }

  async bargeIn(): Promise<void> {
    await this.#runtime.bargeIn();
  }
}

interface SpeechTextBody {
  prompt?: unknown;
}

interface SpeechAudioBody {
  wavBase64?: unknown;
}

interface SpeechSynthesisBody {
  text?: unknown;
}

export function registerSpeechRoutes(
  app: FastifyInstance,
  service: SpeechService,
): void {
  app.get("/api/speech/status", async () => await service.snapshot());

  app.post<{ Body: SpeechTextBody }>(
    "/api/speech/text",
    async (request, reply) => {
      if (
        typeof request.body?.prompt !== "string" ||
        request.body.prompt.trim() === ""
      ) {
        return reply.code(400).send({
          error: "invalid_request",
          message: "'prompt' is required and must be a non-empty string.",
        });
      }
      try {
        return reply
          .code(202)
          .send(await service.submitText(request.body.prompt));
      } catch (error) {
        return sendSpeechError(reply, error);
      }
    },
  );

  app.post<{ Body: SpeechAudioBody }>(
    "/api/speech/audio",
    async (request, reply) => {
      if (
        typeof request.body?.wavBase64 !== "string" ||
        request.body.wavBase64.length === 0
      ) {
        return reply.code(400).send({
          error: "invalid_request",
          message: "'wavBase64' is required and must contain PCM16 WAV data.",
        });
      }
      try {
        const wav = Buffer.from(request.body.wavBase64, "base64");
        if (wav.length === 0) {
          return reply.code(400).send({
            error: "invalid_request",
            message: "'wavBase64' decoded to an empty payload.",
          });
        }
        const task = await service.submitWav(wav);
        return reply.code(task ? 202 : 204).send(task ?? undefined);
      } catch (error) {
        return sendSpeechError(reply, error);
      }
    },
  );

  app.post<{ Body: SpeechSynthesisBody }>(
    "/api/speech/synthesize",
    async (request, reply) => {
      if (
        typeof request.body?.text !== "string" ||
        request.body.text.trim() === ""
      ) {
        return reply.code(400).send({
          error: "invalid_request",
          message: "'text' is required and must be a non-empty string.",
        });
      }
      try {
        const wav = await service.synthesize(request.body.text);
        return { wavBase64: wav.toString("base64"), contentType: "audio/wav" };
      } catch (error) {
        return sendSpeechError(reply, error);
      }
    },
  );

  app.post("/api/speech/barge-in", async (_request, reply) => {
    try {
      await service.bargeIn();
      return { status: "interrupted" };
    } catch (error) {
      return sendSpeechError(reply, error);
    }
  });
}

function createStt(config: TotemSpeechConfig): SpeechToTextAdapter {
  if (config.stt.provider !== "whisper.cpp") {
    return new DisabledSpeechToTextAdapter();
  }
  return new WhisperCppSpeechToTextAdapter({
    executablePath: config.stt.executablePath ?? "",
    modelPath: config.stt.modelPath ?? "",
  });
}

function createTts(config: TotemSpeechConfig): TextToSpeechAdapter {
  if (config.tts.provider !== "piper") {
    return new DisabledTextToSpeechAdapter();
  }
  return new PiperTextToSpeechAdapter({
    executablePath: config.tts.executablePath ?? "",
    modelPath: config.tts.modelPath ?? "",
  });
}

function concatenateAudio(
  chunks: readonly SpeechAudioChunk[],
): SpeechAudioChunk {
  const first = chunks[0];
  if (!first) {
    throw new SpeechRuntimeError(
      "tts_empty_output",
      "No audio chunks supplied",
    );
  }
  const channels = first.channels ?? 1;
  let total = 0;
  for (const chunk of chunks) {
    if (
      chunk.sampleRate !== first.sampleRate ||
      (chunk.channels ?? 1) !== channels
    ) {
      throw new SpeechRuntimeError(
        "tts_format_changed",
        "TTS audio format changed during one synthesis request",
      );
    }
    total += chunk.samples.length;
  }
  const samples = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk.samples, offset);
    offset += chunk.samples.length;
  }
  return { samples, sampleRate: first.sampleRate, channels };
}

function sendSpeechError(
  reply: {
    code(statusCode: number): { send(payload: unknown): unknown };
  },
  error: unknown,
): unknown {
  if (error instanceof SpeechRuntimeError) {
    const unavailable = error.code.endsWith("_unavailable");
    return reply.code(unavailable ? 503 : 400).send({
      error: error.code,
      message: error.message,
    });
  }
  throw error;
}
