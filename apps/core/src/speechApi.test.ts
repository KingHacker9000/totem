import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { encodePcm16Wav } from "./speechAdapters.js";
import {
  registerSpeechRoutes,
  type SpeechService,
  type SpeechServiceSnapshot,
} from "./speechApi.js";
import { SpeechRuntimeError } from "./speechRuntime.js";

const snapshot: SpeechServiceSnapshot = {
  enabled: true,
  taskProviderId: "mock",
  vadThreshold: 0.015,
  runtime: {
    listening: false,
    speaking: false,
    stt: { id: "whisper.cpp", available: true },
    tts: { id: "piper", available: true },
  },
};

class FakeSpeechService implements SpeechService {
  submittedText: string[] = [];
  submittedWav: Buffer[] = [];
  synthesizedText: string[] = [];
  bargedIn = 0;

  async snapshot(): Promise<SpeechServiceSnapshot> {
    return snapshot;
  }

  async submitText(prompt: string) {
    this.submittedText.push(prompt);
    return { taskId: "task_text", sessionId: "sess_text", status: "running" };
  }

  async submitWav(wav: Buffer) {
    this.submittedWav.push(wav);
    return { taskId: "task_audio", sessionId: "sess_audio", status: "running" };
  }

  async synthesize(text: string): Promise<Buffer> {
    this.synthesizedText.push(text);
    return encodePcm16Wav({
      samples: new Float32Array([0, 0.1, -0.1]),
      sampleRate: 16_000,
      channels: 1,
    });
  }

  async bargeIn(): Promise<void> {
    this.bargedIn += 1;
  }
}

describe("speech API", () => {
  it("reports configured speech capability", async () => {
    const app = Fastify({ logger: false });
    registerSpeechRoutes(app, new FakeSpeechService());

    const response = await app.inject({
      method: "GET",
      url: "/api/speech/status",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      enabled: true,
      taskProviderId: "mock",
      runtime: {
        stt: { id: "whisper.cpp", available: true },
        tts: { id: "piper", available: true },
      },
    });
    await app.close();
  });

  it("routes text and PCM16 WAV input into the shared task path", async () => {
    const service = new FakeSpeechService();
    const app = Fastify({ logger: false });
    registerSpeechRoutes(app, service);

    const text = await app.inject({
      method: "POST",
      url: "/api/speech/text",
      payload: { prompt: "hello by keyboard" },
    });
    expect(text.statusCode).toBe(202);
    expect(text.json()).toMatchObject({ taskId: "task_text" });

    const wav = encodePcm16Wav({
      samples: new Float32Array([0.1, 0.2]),
      sampleRate: 16_000,
      channels: 1,
    });
    const audio = await app.inject({
      method: "POST",
      url: "/api/speech/audio",
      payload: { wavBase64: wav.toString("base64") },
    });
    expect(audio.statusCode).toBe(202);
    expect(audio.json()).toMatchObject({ taskId: "task_audio" });
    expect(service.submittedText).toEqual(["hello by keyboard"]);
    expect(service.submittedWav).toHaveLength(1);
    await app.close();
  });

  it("returns browser-playable WAV synthesis and supports barge-in", async () => {
    const service = new FakeSpeechService();
    const app = Fastify({ logger: false });
    registerSpeechRoutes(app, service);

    const synthesis = await app.inject({
      method: "POST",
      url: "/api/speech/synthesize",
      payload: { text: "Totem speaking" },
    });
    expect(synthesis.statusCode).toBe(200);
    const payload = synthesis.json() as {
      wavBase64: string;
      contentType: string;
    };
    expect(payload.contentType).toBe("audio/wav");
    expect(
      Buffer.from(payload.wavBase64, "base64").subarray(0, 4).toString(),
    ).toBe("RIFF");

    const bargeIn = await app.inject({
      method: "POST",
      url: "/api/speech/barge-in",
    });
    expect(bargeIn.statusCode).toBe(200);
    expect(service.bargedIn).toBe(1);
    await app.close();
  });

  it("normalizes speech adapter failures", async () => {
    class FailingService extends FakeSpeechService {
      override async synthesize(): Promise<Buffer> {
        throw new SpeechRuntimeError("tts_unavailable", "tts_disabled");
      }
    }

    const app = Fastify({ logger: false });
    registerSpeechRoutes(app, new FailingService());
    const response = await app.inject({
      method: "POST",
      url: "/api/speech/synthesize",
      payload: { text: "hello" },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "tts_unavailable",
      message: "tts_disabled",
    });
    await app.close();
  });
});
