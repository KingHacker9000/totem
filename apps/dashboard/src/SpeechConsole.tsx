import { useCallback, useRef, useState } from "react";

type SpeechStatus = {
  enabled: boolean;
  taskProviderId: string;
  vadThreshold: number;
  runtime: {
    listening: boolean;
    speaking: boolean;
    activeTaskId?: string;
    activeInput?: "text" | "speech";
    lastTranscript?: string;
    lastInputLatencyMs?: number;
    lastSynthesisLatencyMs?: number;
    stt: {
      id: string;
      available: boolean;
      reason?: string;
      modelPath?: string;
    };
    tts: {
      id: string;
      available: boolean;
      reason?: string;
      modelPath?: string;
    };
    voice?: { voiceId?: string; modelPath?: string };
  };
};

type RecorderState = {
  context: AudioContext;
  processor: ScriptProcessorNode;
  source: MediaStreamAudioSourceNode;
  stream: MediaStream;
  sampleRate: number;
};

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(
      payload?.message ?? `${path} returned HTTP ${response.status}`,
    );
  }
  return (await response.json()) as T;
}

export function SpeechConsole() {
  const [status, setStatus] = useState<SpeechStatus | null>(null);
  const [recording, setRecording] = useState(false);
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const recorder = useRef<RecorderState | null>(null);
  const chunks = useRef<Float32Array[]>([]);

  const refresh = useCallback(async () => {
    try {
      const next = await jsonRequest<SpeechStatus>("/api/speech/status");
      setStatus(next);
      setMessage(null);
    } catch (error) {
      setStatus(null);
      setMessage(
        error instanceof Error ? error.message : "Speech status failed",
      );
    }
  }, []);

  const startRecording = async () => {
    setMessage(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage("This browser does not expose microphone capture.");
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    chunks.current = [];
    processor.onaudioprocess = (event) => {
      chunks.current.push(
        new Float32Array(event.inputBuffer.getChannelData(0)),
      );
    };
    source.connect(processor);
    processor.connect(context.destination);
    recorder.current = {
      context,
      processor,
      source,
      stream,
      sampleRate: context.sampleRate,
    };
    setRecording(true);
  };

  const stopRecording = async () => {
    const active = recorder.current;
    if (!active) return;
    recorder.current = null;
    setRecording(false);
    active.processor.disconnect();
    active.source.disconnect();
    for (const track of active.stream.getTracks()) track.stop();
    await active.context.close();

    const samples = concatenate(chunks.current);
    chunks.current = [];
    if (samples.length === 0) {
      setMessage("No microphone samples were captured.");
      return;
    }

    setBusy(true);
    try {
      const wav = encodePcm16Wav(samples, active.sampleRate);
      const result = await jsonRequest<{ taskId: string }>(
        "/api/speech/audio",
        {
          method: "POST",
          body: JSON.stringify({ wavBase64: bytesToBase64(wav) }),
        },
      );
      setMessage(`Speech task started: ${result.taskId}`);
      await refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Speech input failed",
      );
    } finally {
      setBusy(false);
    }
  };

  const submitText = async () => {
    const prompt = text.trim();
    if (!prompt) return;
    setBusy(true);
    try {
      const result = await jsonRequest<{ taskId: string }>("/api/speech/text", {
        method: "POST",
        body: JSON.stringify({ prompt }),
      });
      setText("");
      setMessage(`Text task started: ${result.taskId}`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Text input failed");
    } finally {
      setBusy(false);
    }
  };

  const speak = async () => {
    const phrase = text.trim();
    if (!phrase) return;
    setBusy(true);
    try {
      const result = await jsonRequest<{
        wavBase64: string;
        contentType: string;
      }>("/api/speech/synthesize", {
        method: "POST",
        body: JSON.stringify({ text: phrase }),
      });
      const player = new Audio(
        `data:${result.contentType};base64,${result.wavBase64}`,
      );
      await player.play();
      setMessage("Playing local TTS through this PC/browser.");
      await refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "TTS playback failed",
      );
    } finally {
      setBusy(false);
    }
  };

  const bargeIn = async () => {
    setBusy(true);
    try {
      await jsonRequest<{ status: string }>("/api/speech/barge-in", {
        method: "POST",
        body: "{}",
      });
      setMessage("Speech playback/task interruption requested.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Barge-in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">T</span>
          <div>
            <strong>Totem</strong>
            <span>Speech Console</span>
          </div>
        </div>
        <nav aria-label="Speech navigation">
          <a className="nav-item" href="/">
            Dashboard
          </a>
          <a className="nav-item" href="/operator">
            Operator
          </a>
          <a className="nav-item" href="/providers">
            Providers
          </a>
          <button
            className="nav-item active"
            onClick={() => void refresh()}
            type="button"
          >
            Refresh speech
          </button>
        </nav>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Local audio · provider-neutral tasks</p>
            <h1>Speech</h1>
          </div>
          <div className="connection-pill live">
            {status ? status.taskProviderId : "not checked"}
          </div>
        </header>

        {message ? <div className="notice">{message}</div> : null}

        <div className="overview-grid">
          <section className="hero-card">
            <div>
              <p className="eyebrow">Push to talk</p>
              <h2>Use the PC microphone without a native audio dependency</h2>
              <p>
                The browser captures mono PCM audio, Totem transcribes it
                locally, then sends the transcript through the same durable task
                gateway as typed input. Raw microphone samples are not persisted
                by the speech runtime.
              </p>
            </div>
            <button
              disabled={busy}
              onClick={() =>
                void (recording ? stopRecording() : startRecording())
              }
              type="button"
            >
              {recording ? "Stop & transcribe" : "Start microphone"}
            </button>
          </section>

          <section className="metric-card">
            <span>STT</span>
            <strong>
              {status?.runtime.stt.available
                ? status.runtime.stt.id
                : "Unavailable"}
            </strong>
            <small>
              {status?.runtime.stt.reason ??
                status?.runtime.stt.modelPath ??
                "Refresh to check"}
            </small>
          </section>
          <section className="metric-card">
            <span>TTS</span>
            <strong>
              {status?.runtime.tts.available
                ? status.runtime.tts.id
                : "Unavailable"}
            </strong>
            <small>
              {status?.runtime.tts.reason ??
                status?.runtime.tts.modelPath ??
                "Refresh to check"}
            </small>
          </section>

          <section className="phase-card">
            <div>
              <p className="eyebrow">Text / local TTS</p>
              <h3>Exercise the same task and voice paths</h3>
            </div>
            <input
              aria-label="Speech console text"
              onChange={(event) => setText(event.target.value)}
              placeholder="Type a prompt or phrase to synthesize"
              type="text"
              value={text}
            />
            <p>
              <button
                disabled={busy || !text.trim()}
                onClick={() => void submitText()}
                type="button"
              >
                Send as task
              </button>{" "}
              <button
                disabled={busy || !text.trim()}
                onClick={() => void speak()}
                type="button"
              >
                Speak locally
              </button>{" "}
              <button
                disabled={busy}
                onClick={() => void bargeIn()}
                type="button"
              >
                Barge in / stop
              </button>
            </p>
          </section>

          <section className="phase-card muted-card">
            <div>
              <p className="eyebrow">Latest speech state</p>
              <h3>{status?.runtime.lastTranscript ?? "No transcript yet"}</h3>
            </div>
            <p>
              Input latency: {status?.runtime.lastInputLatencyMs ?? "—"} ms ·
              synthesis latency: {status?.runtime.lastSynthesisLatencyMs ?? "—"}{" "}
              ms · VAD threshold: {status?.vadThreshold ?? "—"}
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}

function concatenate(chunks: readonly Float32Array[]): Float32Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function encodePcm16Wav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(bytes, 8, "WAVE");
  writeAscii(bytes, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(bytes, 36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((value, index) => {
    const sample = Math.max(-1, Math.min(1, value));
    view.setInt16(
      44 + index * 2,
      sample < 0 ? sample * 0x8000 : sample * 0x7fff,
      true,
    );
  });
  return bytes;
}

function writeAscii(target: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    target[offset + index] = value.charCodeAt(index);
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}
