import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodePcm16Wav,
  encodePcm16Wav,
  PiperTextToSpeechAdapter,
  type SpeechProcessRequest,
  type SpeechProcessResult,
  type SpeechProcessRunner,
  WhisperCppSpeechToTextAdapter,
} from "./speechAdapters.js";
import { SpeechRuntimeError } from "./speechRuntime.js";

const audio = () => ({
  samples: new Float32Array([-1, -0.25, 0, 0.25, 1]),
  sampleRate: 16_000,
  channels: 1,
});

class FakeRunner implements SpeechProcessRunner {
  requests: SpeechProcessRequest[] = [];
  readonly #handler: (
    request: SpeechProcessRequest,
  ) => Promise<SpeechProcessResult>;

  constructor(
    handler: (request: SpeechProcessRequest) => Promise<SpeechProcessResult>,
  ) {
    this.#handler = handler;
  }

  async run(request: SpeechProcessRequest): Promise<SpeechProcessResult> {
    this.requests.push(request);
    return await this.#handler(request);
  }
}

describe("PCM16 WAV helpers", () => {
  it("round-trips local speech audio", () => {
    const original = audio();
    const decoded = decodePcm16Wav(encodePcm16Wav(original));

    expect(decoded.sampleRate).toBe(original.sampleRate);
    expect(decoded.channels).toBe(original.channels);
    expect(Array.from(decoded.samples)).toEqual(
      expect.arrayContaining([
        expect.closeTo(-1, 4),
        expect.closeTo(-0.25, 4),
        expect.closeTo(0, 4),
        expect.closeTo(0.25, 4),
        expect.closeTo(1, 4),
      ]),
    );
  });

  it("rejects unsupported input", () => {
    expect(() => decodePcm16Wav(Buffer.from("not-wave"))).toThrow(
      SpeechRuntimeError,
    );
  });
});

describe("WhisperCppSpeechToTextAdapter", () => {
  it("writes a WAV, invokes whisper-cli, and returns the transcript", async () => {
    const root = await mkdtemp(join(tmpdir(), "totem-whisper-test-"));
    try {
      const executablePath = join(root, "whisper-cli");
      const modelPath = join(root, "model.bin");
      await writeFile(executablePath, "fixture");
      await writeFile(modelPath, "fixture");

      const runner = new FakeRunner(async (request) => {
        const outputIndex = request.args.indexOf("--output-file");
        const outputPrefix = request.args[outputIndex + 1];
        if (!outputPrefix) throw new Error("missing output prefix");
        await writeFile(`${outputPrefix}.txt`, "  hello from whisper  \n");
        return { stdout: "", stderr: "", exitCode: 0 };
      });
      const adapter = new WhisperCppSpeechToTextAdapter({
        executablePath,
        modelPath,
        tempRoot: root,
        runner,
      });

      await expect(adapter.status()).resolves.toMatchObject({
        available: true,
        modelPath,
      });
      await expect(
        adapter.transcribe(audio(), new AbortController().signal),
      ).resolves.toBe("hello from whisper");
      expect(runner.requests).toHaveLength(1);
      expect(runner.requests[0]?.args).toEqual(
        expect.arrayContaining(["--model", modelPath, "--output-txt"]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports missing executable without spawning", async () => {
    const root = await mkdtemp(join(tmpdir(), "totem-whisper-status-"));
    try {
      const modelPath = join(root, "model.bin");
      await writeFile(modelPath, "fixture");
      const runner = new FakeRunner(async () => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
      }));
      const adapter = new WhisperCppSpeechToTextAdapter({
        executablePath: join(root, "missing-whisper"),
        modelPath,
        tempRoot: root,
        runner,
      });

      await expect(adapter.status()).resolves.toMatchObject({
        available: false,
        reason: "stt_executable_not_found",
      });
      expect(runner.requests).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("PiperTextToSpeechAdapter", () => {
  it("pipes text to Piper and yields decoded speech audio", async () => {
    const root = await mkdtemp(join(tmpdir(), "totem-piper-test-"));
    try {
      const executablePath = join(root, "piper");
      const modelPath = join(root, "voice.onnx");
      await writeFile(executablePath, "fixture");
      await writeFile(modelPath, "fixture");

      const runner = new FakeRunner(async (request) => {
        const outputIndex = request.args.indexOf("--output_file");
        const outputPath = request.args[outputIndex + 1];
        if (!outputPath) throw new Error("missing output path");
        await writeFile(outputPath, encodePcm16Wav(audio()));
        return { stdout: "", stderr: "", exitCode: 0 };
      });
      const adapter = new PiperTextToSpeechAdapter({
        executablePath,
        modelPath,
        tempRoot: root,
        runner,
      });

      await expect(adapter.status()).resolves.toMatchObject({
        available: true,
        modelPath,
      });
      const chunks = [];
      for await (const chunk of adapter.synthesize(
        "hello from Totem",
        {},
        new AbortController().signal,
      )) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]?.sampleRate).toBe(16_000);
      expect(runner.requests[0]?.stdin).toBe("hello from Totem\n");
      expect(runner.requests[0]?.args).toEqual(
        expect.arrayContaining(["--model", modelPath]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("surfaces process failures without leaking files", async () => {
    const root = await mkdtemp(join(tmpdir(), "totem-piper-failure-"));
    try {
      const executablePath = join(root, "piper");
      const modelPath = join(root, "voice.onnx");
      await writeFile(executablePath, "fixture");
      await writeFile(modelPath, "fixture");
      const runner = new FakeRunner(async () => ({
        stdout: "",
        stderr: "fixture failure",
        exitCode: 2,
      }));
      const adapter = new PiperTextToSpeechAdapter({
        executablePath,
        modelPath,
        tempRoot: root,
        runner,
      });

      const consume = async () => {
        for await (const _chunk of adapter.synthesize(
          "hello",
          {},
          new AbortController().signal,
        )) {
          // No chunk expected on failure.
        }
      };
      await expect(consume()).rejects.toMatchObject({
        code: "speech_process_failed",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
