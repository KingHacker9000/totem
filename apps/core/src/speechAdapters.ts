import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type SpeechAdapterStatus,
  type SpeechAudioChunk,
  SpeechRuntimeError,
  type SpeechSynthesisOptions,
  type SpeechToTextAdapter,
  type TextToSpeechAdapter,
} from "./speechRuntime.js";

export interface SpeechProcessRequest {
  command: string;
  args: readonly string[];
  stdin?: string | Buffer;
  signal: AbortSignal;
}

export interface SpeechProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SpeechProcessRunner {
  run(request: SpeechProcessRequest): Promise<SpeechProcessResult>;
}

export class NodeSpeechProcessRunner implements SpeechProcessRunner {
  async run(request: SpeechProcessRequest): Promise<SpeechProcessResult> {
    if (request.signal.aborted) {
      throw new SpeechRuntimeError(
        "speech_process_aborted",
        `Speech process '${request.command}' was aborted before launch`,
      );
    }

    return await new Promise<SpeechProcessResult>((resolve, reject) => {
      const child = spawn(request.command, [...request.args], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;

      const finishReject = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      const onAbort = () => {
        child.kill();
        finishReject(
          new SpeechRuntimeError(
            "speech_process_aborted",
            `Speech process '${request.command}' was aborted`,
          ),
        );
      };
      request.signal.addEventListener("abort", onAbort, { once: true });

      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      child.once("error", finishReject);
      child.once("close", (code) => {
        request.signal.removeEventListener("abort", onAbort);
        if (settled) return;
        settled = true;
        resolve({
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          exitCode: code ?? -1,
        });
      });

      if (request.stdin !== undefined) child.stdin.end(request.stdin);
      else child.stdin.end();
    });
  }
}

export interface WhisperCppAdapterConfig {
  executablePath: string;
  modelPath: string;
  runner?: SpeechProcessRunner;
  tempRoot?: string;
}

/**
 * Concrete local STT adapter for whisper.cpp's `whisper-cli` executable.
 * Totem owns only process orchestration; the executable and model stay external
 * and are configured by path.
 */
export class WhisperCppSpeechToTextAdapter implements SpeechToTextAdapter {
  readonly id = "whisper.cpp";
  readonly executablePath: string;
  readonly modelPath: string;
  readonly #runner: SpeechProcessRunner;
  readonly #tempRoot: string;

  constructor(config: WhisperCppAdapterConfig) {
    this.executablePath = config.executablePath.trim();
    this.modelPath = config.modelPath.trim();
    this.#runner = config.runner ?? new NodeSpeechProcessRunner();
    this.#tempRoot = config.tempRoot ?? tmpdir();
  }

  async status(): Promise<SpeechAdapterStatus> {
    const executable = await pathStatus(this.executablePath);
    if (!executable) {
      return {
        available: false,
        reason: "stt_executable_not_found",
        modelPath: this.modelPath || undefined,
      };
    }
    const model = await pathStatus(this.modelPath);
    if (!model) {
      return {
        available: false,
        reason: "stt_model_not_found",
        modelPath: this.modelPath || undefined,
      };
    }
    return { available: true, modelPath: this.modelPath };
  }

  async transcribe(
    audio: SpeechAudioChunk,
    signal: AbortSignal,
  ): Promise<string> {
    assertAudio(audio);
    const status = await this.status();
    if (!status.available) {
      throw new SpeechRuntimeError(
        "stt_unavailable",
        status.reason ?? "whisper.cpp is unavailable",
      );
    }

    const workDir = await mkdtemp(join(this.#tempRoot, "totem-whisper-"));
    const inputPath = join(workDir, "input.wav");
    const outputPrefix = join(workDir, "transcript");
    const outputPath = `${outputPrefix}.txt`;
    try {
      await writeFile(inputPath, encodePcm16Wav(audio));
      const result = await this.#runner.run({
        command: this.executablePath,
        args: [
          "--model",
          this.modelPath,
          "--file",
          inputPath,
          "--output-txt",
          "--output-file",
          outputPrefix,
          "--no-prints",
        ],
        signal,
      });
      assertProcessSuccess("whisper.cpp", result);
      return (await readFile(outputPath, "utf8")).trim();
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}

export interface PiperAdapterConfig {
  executablePath: string;
  modelPath: string;
  runner?: SpeechProcessRunner;
  tempRoot?: string;
}

/** Concrete local TTS adapter for the Piper command-line synthesizer. */
export class PiperTextToSpeechAdapter implements TextToSpeechAdapter {
  readonly id = "piper";
  readonly executablePath: string;
  readonly modelPath: string;
  readonly #runner: SpeechProcessRunner;
  readonly #tempRoot: string;

  constructor(config: PiperAdapterConfig) {
    this.executablePath = config.executablePath.trim();
    this.modelPath = config.modelPath.trim();
    this.#runner = config.runner ?? new NodeSpeechProcessRunner();
    this.#tempRoot = config.tempRoot ?? tmpdir();
  }

  async status(): Promise<SpeechAdapterStatus> {
    const executable = await pathStatus(this.executablePath);
    if (!executable) {
      return {
        available: false,
        reason: "tts_executable_not_found",
        modelPath: this.modelPath || undefined,
      };
    }
    const model = await pathStatus(this.modelPath);
    if (!model) {
      return {
        available: false,
        reason: "tts_model_not_found",
        modelPath: this.modelPath || undefined,
      };
    }
    return { available: true, modelPath: this.modelPath };
  }

  async *synthesize(
    text: string,
    options: SpeechSynthesisOptions,
    signal: AbortSignal,
  ): AsyncIterable<SpeechAudioChunk> {
    const normalized = text.trim();
    if (!normalized) return;
    const modelPath = options.modelPath?.trim() || this.modelPath;
    if (!(await pathStatus(this.executablePath))) {
      throw new SpeechRuntimeError(
        "tts_unavailable",
        "tts_executable_not_found",
      );
    }
    if (!(await pathStatus(modelPath))) {
      throw new SpeechRuntimeError("tts_unavailable", "tts_model_not_found");
    }

    const workDir = await mkdtemp(join(this.#tempRoot, "totem-piper-"));
    const outputPath = join(workDir, "speech.wav");
    try {
      const result = await this.#runner.run({
        command: this.executablePath,
        args: ["--model", modelPath, "--output_file", outputPath],
        stdin: `${normalized}\n`,
        signal,
      });
      assertProcessSuccess("piper", result);
      yield decodePcm16Wav(await readFile(outputPath));
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}

export function encodePcm16Wav(audio: SpeechAudioChunk): Buffer {
  assertAudio(audio);
  const channels = audio.channels ?? 1;
  const bytesPerSample = 2;
  const dataSize = audio.samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(audio.sampleRate, 24);
  buffer.writeUInt32LE(audio.sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < audio.samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, audio.samples[index] ?? 0));
    const pcm =
      sample < 0 ? Math.round(sample * 32_768) : Math.round(sample * 32_767);
    buffer.writeInt16LE(pcm, 44 + index * bytesPerSample);
  }
  return buffer;
}

export function decodePcm16Wav(buffer: Buffer): SpeechAudioChunk {
  if (
    buffer.length < 44 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new SpeechRuntimeError("invalid_wav", "Expected a RIFF/WAVE file");
  }

  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let format = 0;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkData = offset + 8;
    if (chunkData + chunkSize > buffer.length) {
      throw new SpeechRuntimeError(
        "invalid_wav",
        "WAV chunk exceeds file size",
      );
    }
    if (chunkId === "fmt ") {
      if (chunkSize < 16) {
        throw new SpeechRuntimeError(
          "invalid_wav",
          "WAV fmt chunk is too small",
        );
      }
      format = buffer.readUInt16LE(chunkData);
      channels = buffer.readUInt16LE(chunkData + 2);
      sampleRate = buffer.readUInt32LE(chunkData + 4);
      bitsPerSample = buffer.readUInt16LE(chunkData + 14);
    } else if (chunkId === "data") {
      dataOffset = chunkData;
      dataSize = chunkSize;
    }
    offset = chunkData + chunkSize + (chunkSize % 2);
  }

  if (
    format !== 1 ||
    channels < 1 ||
    sampleRate < 1 ||
    bitsPerSample !== 16 ||
    dataOffset < 0 ||
    dataSize % 2 !== 0
  ) {
    throw new SpeechRuntimeError(
      "unsupported_wav",
      "Only uncompressed 16-bit PCM WAV audio is supported",
    );
  }

  const samples = new Float32Array(dataSize / 2);
  for (let index = 0; index < samples.length; index += 1) {
    const pcm = buffer.readInt16LE(dataOffset + index * 2);
    samples[index] = pcm < 0 ? pcm / 32_768 : pcm / 32_767;
  }
  return { samples, sampleRate, channels };
}

async function pathStatus(path: string): Promise<boolean> {
  if (!path) return false;
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function assertAudio(audio: SpeechAudioChunk): void {
  const channels = audio.channels ?? 1;
  if (
    !Number.isInteger(audio.sampleRate) ||
    audio.sampleRate < 1 ||
    !Number.isInteger(channels) ||
    channels < 1 ||
    audio.samples.length === 0 ||
    audio.samples.length % channels !== 0
  ) {
    throw new SpeechRuntimeError(
      "invalid_audio",
      "Audio requires a positive sample rate/channels and complete non-empty frames",
    );
  }
}

function assertProcessSuccess(name: string, result: SpeechProcessResult): void {
  if (result.exitCode === 0) return;
  const detail = result.stderr.trim() || result.stdout.trim();
  throw new SpeechRuntimeError(
    "speech_process_failed",
    `${name} exited with code ${result.exitCode}${detail ? `: ${detail}` : ""}`,
  );
}
