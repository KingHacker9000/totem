import { describe, expect, it, vi } from "vitest";
import {
  EnergyVad,
  SpeechRuntime,
  SpeechRuntimeError,
  type SpeechAudioChunk,
  type SpeechPlaybackSink,
  type SpeechTaskGateway,
  type SpeechToTextAdapter,
  type TextToSpeechAdapter,
} from "./speechRuntime.js";

const audio = (value = 0.2): SpeechAudioChunk => ({
  samples: new Float32Array([value, value, value, value]),
  sampleRate: 16_000,
});

function fixture() {
  const starts: string[] = [];
  const interrupted: string[] = [];
  const played: SpeechAudioChunk[] = [];
  const tasks: SpeechTaskGateway = {
    async startTask(input) {
      starts.push(input.prompt);
      return { taskId: `task-${starts.length}`, status: "queued" };
    },
    async interruptTask(taskId) {
      interrupted.push(taskId);
    },
  };
  const stt: SpeechToTextAdapter = {
    id: "mock-stt",
    status: () => ({ available: true }),
    transcribe: async () => "  hello by voice  ",
  };
  const tts: TextToSpeechAdapter = {
    id: "mock-tts",
    status: () => ({ available: true }),
    async *synthesize(_text, _options, signal) {
      if (!signal.aborted) yield audio(0.1);
      if (!signal.aborted) yield audio(0.2);
    },
  };
  const playback: SpeechPlaybackSink = {
    async play(chunk) {
      played.push(chunk);
    },
    stop: vi.fn(),
  };
  const runtime = new SpeechRuntime({
    tasks,
    vad: new EnergyVad(0.01),
    stt,
    tts,
    playback,
    resolveVoice: () => ({ voiceId: "theme-voice", modelPath: "/voices/theme.onnx" }),
    now: (() => {
      let now = 100;
      return () => (now += 5);
    })(),
  });
  return { runtime, starts, interrupted, played, playback };
}

describe("SpeechRuntime", () => {
  it("routes keyboard and speech input through the same task gateway", async () => {
    const { runtime, starts } = fixture();

    const textTask = await runtime.submitText("keyboard prompt");
    const speechTask = await runtime.submitAudio(audio());

    expect(textTask.taskId).toBe("task-1");
    expect(speechTask?.taskId).toBe("task-2");
    expect(starts).toEqual(["keyboard prompt", "hello by voice"]);
    expect(await runtime.snapshot()).toMatchObject({
      activeTaskId: "task-2",
      activeInput: "speech",
      lastTranscript: "hello by voice",
      stt: { id: "mock-stt", available: true },
      tts: { id: "mock-tts", available: true },
      voice: { voiceId: "theme-voice", modelPath: "/voices/theme.onnx" },
    });
  });

  it("ignores audio that does not pass VAD", async () => {
    const { runtime, starts } = fixture();
    expect(await runtime.submitAudio(audio(0.001))).toBeUndefined();
    expect(starts).toEqual([]);
  });

  it("streams synthesis chunks and supports barge-in cancellation", async () => {
    const { runtime, interrupted, played, playback } = fixture();
    await runtime.submitText("task to interrupt");
    await runtime.speak("response");
    expect(played).toHaveLength(2);

    await runtime.bargeIn();
    expect(interrupted).toEqual(["task-1"]);
    expect(playback.stop).toHaveBeenCalled();
    expect((await runtime.snapshot()).activeTaskId).toBeUndefined();
  });

  it("fails safely when STT is unavailable", async () => {
    const runtime = new SpeechRuntime({
      tasks: {
        startTask: vi.fn(),
        interruptTask: vi.fn(),
      },
      vad: new EnergyVad(0),
      stt: {
        id: "missing-stt",
        status: () => ({ available: false, reason: "model_path_not_configured" }),
        transcribe: vi.fn(),
      },
      tts: {
        id: "mock-tts",
        status: () => ({ available: true }),
        async *synthesize() {},
      },
      playback: { play: vi.fn(), stop: vi.fn() },
    });

    await expect(runtime.submitAudio(audio())).rejects.toMatchObject({
      code: "stt_unavailable",
    } satisfies Partial<SpeechRuntimeError>);
  });

  it("validates VAD thresholds", () => {
    expect(() => new EnergyVad(2)).toThrowError(SpeechRuntimeError);
  });
});
