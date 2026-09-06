import { access } from "node:fs/promises";

export interface SpeechAudioChunk {
  samples: Float32Array;
  sampleRate: number;
  channels?: number;
}

export interface SpeechTaskHandle {
  taskId: string;
  sessionId?: string;
  status?: string;
}

export interface SpeechTaskGateway {
  startTask(input: {
    prompt: string;
    kind?: string;
    title?: string;
  }): Promise<SpeechTaskHandle>;
  interruptTask(taskId: string): Promise<void>;
}

export interface VoiceActivityDetector {
  hasSpeech(audio: SpeechAudioChunk): Promise<boolean> | boolean;
}

export interface SpeechToTextAdapter {
  readonly id: string;
  transcribe(audio: SpeechAudioChunk, signal: AbortSignal): Promise<string>;
  status(): Promise<SpeechAdapterStatus> | SpeechAdapterStatus;
}

export interface TextToSpeechAdapter {
  readonly id: string;
  synthesize(
    text: string,
    options: SpeechSynthesisOptions,
    signal: AbortSignal,
  ): AsyncIterable<SpeechAudioChunk>;
  status(): Promise<SpeechAdapterStatus> | SpeechAdapterStatus;
}

export interface SpeechPlaybackSink {
  play(chunk: SpeechAudioChunk, signal: AbortSignal): Promise<void>;
  stop(): Promise<void> | void;
}

export interface SpeechAdapterStatus {
  available: boolean;
  reason?: string;
  modelPath?: string;
}

export interface SpeechSynthesisOptions {
  voiceId?: string;
  modelPath?: string;
}

export interface SpeechVoiceSelection {
  voiceId?: string;
  modelPath?: string;
}

export interface SpeechRuntimeOptions {
  tasks: SpeechTaskGateway;
  vad: VoiceActivityDetector;
  stt: SpeechToTextAdapter;
  tts: TextToSpeechAdapter;
  playback: SpeechPlaybackSink;
  resolveVoice?: () =>
    | Promise<SpeechVoiceSelection | undefined>
    | SpeechVoiceSelection
    | undefined;
  now?: () => number;
}

export interface SpeechRuntimeSnapshot {
  listening: boolean;
  speaking: boolean;
  activeTaskId?: string;
  activeInput?: "text" | "speech";
  lastTranscript?: string;
  lastInputLatencyMs?: number;
  lastSynthesisLatencyMs?: number;
  stt: SpeechAdapterStatus & { id: string };
  tts: SpeechAdapterStatus & { id: string };
  voice?: SpeechVoiceSelection;
}

/**
 * Provider-neutral speech coordinator. Speech and keyboard text deliberately
 * converge on the same task gateway, so speech never owns a second task model.
 * Audio remains ephemeral; this runtime does not persist microphone samples.
 */
export class SpeechRuntime {
  readonly #tasks: SpeechTaskGateway;
  readonly #vad: VoiceActivityDetector;
  readonly #stt: SpeechToTextAdapter;
  readonly #tts: TextToSpeechAdapter;
  readonly #playback: SpeechPlaybackSink;
  readonly #resolveVoice?: SpeechRuntimeOptions["resolveVoice"];
  readonly #now: () => number;

  #inputAbort?: AbortController;
  #playbackAbort?: AbortController;
  #activeTaskId?: string;
  #activeInput?: "text" | "speech";
  #lastTranscript?: string;
  #lastInputLatencyMs?: number;
  #lastSynthesisLatencyMs?: number;
  #speaking = false;
  #listening = false;

  constructor(options: SpeechRuntimeOptions) {
    this.#tasks = options.tasks;
    this.#vad = options.vad;
    this.#stt = options.stt;
    this.#tts = options.tts;
    this.#playback = options.playback;
    this.#resolveVoice = options.resolveVoice;
    this.#now = options.now ?? (() => Date.now());
  }

  async submitText(prompt: string): Promise<SpeechTaskHandle> {
    const normalized = prompt.trim();
    if (!normalized)
      throw new SpeechRuntimeError(
        "prompt_required",
        "prompt must not be empty",
      );
    const task = await this.#tasks.startTask({
      prompt: normalized,
      kind: "assistant",
    });
    this.#activeTaskId = task.taskId;
    this.#activeInput = "text";
    return task;
  }

  async submitAudio(
    audio: SpeechAudioChunk,
  ): Promise<SpeechTaskHandle | undefined> {
    this.#inputAbort?.abort();
    const controller = new AbortController();
    this.#inputAbort = controller;
    this.#listening = true;
    const started = this.#now();
    try {
      if (!(await this.#vad.hasSpeech(audio))) return undefined;
      const status = await this.#stt.status();
      if (!status.available) {
        throw new SpeechRuntimeError(
          "stt_unavailable",
          status.reason ?? `STT adapter '${this.#stt.id}' is unavailable`,
        );
      }
      const transcript = (
        await this.#stt.transcribe(audio, controller.signal)
      ).trim();
      if (!transcript) return undefined;
      this.#lastTranscript = transcript;
      this.#lastInputLatencyMs = Math.max(0, this.#now() - started);
      const task = await this.#tasks.startTask({
        prompt: transcript,
        kind: "assistant",
      });
      this.#activeTaskId = task.taskId;
      this.#activeInput = "speech";
      return task;
    } finally {
      if (this.#inputAbort === controller) this.#inputAbort = undefined;
      this.#listening = false;
    }
  }

  async speak(text: string): Promise<void> {
    const normalized = text.trim();
    if (!normalized) return;
    await this.stopPlayback();
    const status = await this.#tts.status();
    if (!status.available) {
      throw new SpeechRuntimeError(
        "tts_unavailable",
        status.reason ?? `TTS adapter '${this.#tts.id}' is unavailable`,
      );
    }

    const controller = new AbortController();
    this.#playbackAbort = controller;
    this.#speaking = true;
    const started = this.#now();
    const voice = await this.#resolveVoice?.();
    try {
      for await (const chunk of this.#tts.synthesize(
        normalized,
        voice ?? {},
        controller.signal,
      )) {
        if (controller.signal.aborted) break;
        await this.#playback.play(chunk, controller.signal);
      }
      this.#lastSynthesisLatencyMs = Math.max(0, this.#now() - started);
    } finally {
      if (this.#playbackAbort === controller) this.#playbackAbort = undefined;
      this.#speaking = false;
    }
  }

  async stopPlayback(): Promise<void> {
    this.#playbackAbort?.abort();
    this.#playbackAbort = undefined;
    this.#speaking = false;
    await this.#playback.stop();
  }

  async bargeIn(): Promise<void> {
    this.#inputAbort?.abort();
    await this.stopPlayback();
    const taskId = this.#activeTaskId;
    if (taskId) {
      await this.#tasks.interruptTask(taskId);
      this.#activeTaskId = undefined;
    }
  }

  async snapshot(): Promise<SpeechRuntimeSnapshot> {
    const voice = await this.#resolveVoice?.();
    return {
      listening: this.#listening,
      speaking: this.#speaking,
      ...(this.#activeTaskId ? { activeTaskId: this.#activeTaskId } : {}),
      ...(this.#activeInput ? { activeInput: this.#activeInput } : {}),
      ...(this.#lastTranscript ? { lastTranscript: this.#lastTranscript } : {}),
      ...(this.#lastInputLatencyMs !== undefined
        ? { lastInputLatencyMs: this.#lastInputLatencyMs }
        : {}),
      ...(this.#lastSynthesisLatencyMs !== undefined
        ? { lastSynthesisLatencyMs: this.#lastSynthesisLatencyMs }
        : {}),
      stt: { id: this.#stt.id, ...(await this.#stt.status()) },
      tts: { id: this.#tts.id, ...(await this.#tts.status()) },
      ...(voice ? { voice } : {}),
    };
  }
}

/** Deterministic energy gate suitable for CI and a lightweight PC baseline. */
export class EnergyVad implements VoiceActivityDetector {
  readonly #threshold: number;

  constructor(threshold = 0.015) {
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      throw new SpeechRuntimeError(
        "invalid_vad_threshold",
        "VAD threshold must be between 0 and 1",
      );
    }
    this.#threshold = threshold;
  }

  hasSpeech(audio: SpeechAudioChunk): boolean {
    if (audio.samples.length === 0) return false;
    let energy = 0;
    for (const sample of audio.samples) energy += sample * sample;
    return Math.sqrt(energy / audio.samples.length) >= this.#threshold;
  }
}

export interface LocalModelAdapterConfig {
  id: string;
  modelPath?: string;
}

/** Shared availability behavior for local-model adapters without bundling a model. */
export abstract class LocalModelAdapter {
  readonly id: string;
  readonly modelPath?: string;

  protected constructor(config: LocalModelAdapterConfig) {
    this.id = config.id;
    this.modelPath = config.modelPath?.trim() || undefined;
  }

  async status(): Promise<SpeechAdapterStatus> {
    if (!this.modelPath) {
      return { available: false, reason: "model_path_not_configured" };
    }
    try {
      await access(this.modelPath);
      return { available: true, modelPath: this.modelPath };
    } catch {
      return {
        available: false,
        reason: "model_path_not_found",
        modelPath: this.modelPath,
      };
    }
  }
}

export class SpeechRuntimeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SpeechRuntimeError";
    this.code = code;
  }
}
