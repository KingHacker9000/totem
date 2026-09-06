export type DriverKind = "display" | "touch" | "audio" | "led";

export interface DriverStatus {
  kind: DriverKind;
  id: string;
  available: boolean;
  detail?: string;
}

export interface DisplayFrame {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export interface DisplayDriver {
  readonly kind: "display";
  readonly id: string;
  status(): Promise<DriverStatus>;
  present(frame: DisplayFrame): Promise<void>;
  close(): Promise<void>;
}

export interface TouchPoint {
  x: number;
  y: number;
  pressed: boolean;
  timestampMs: number;
}

export interface TouchDriver {
  readonly kind: "touch";
  readonly id: string;
  status(): Promise<DriverStatus>;
  read(): Promise<TouchPoint | null>;
  close(): Promise<void>;
}

export interface AudioChunk {
  sampleRateHz: number;
  channels: number;
  pcm16: Int16Array;
}

export interface AudioDriver {
  readonly kind: "audio";
  readonly id: string;
  status(): Promise<DriverStatus>;
  capture(): AsyncIterable<AudioChunk>;
  play(chunk: AudioChunk): Promise<void>;
  stopPlayback(): Promise<void>;
  close(): Promise<void>;
}

export interface LedState {
  effect: "off" | "solid" | "pulse" | "breathe";
  intensity: number;
  semanticColor?: string;
}

export interface LedDriver {
  readonly kind: "led";
  readonly id: string;
  status(): Promise<DriverStatus>;
  set(state: LedState): Promise<void>;
  close(): Promise<void>;
}

export interface DeviceDrivers {
  display: DisplayDriver;
  touch: TouchDriver;
  audio: AudioDriver;
  led: LedDriver;
}

const status = (
  kind: DriverKind,
  id: string,
  available: boolean,
  detail?: string,
): DriverStatus => ({
  kind,
  id,
  available,
  ...(detail === undefined ? {} : { detail }),
});

export class HeadlessDisplayDriver implements DisplayDriver {
  readonly kind = "display" as const;
  readonly id = "headless";

  async status(): Promise<DriverStatus> {
    return status(
      this.kind,
      this.id,
      true,
      "Frames are intentionally discarded",
    );
  }

  async present(_frame: DisplayFrame): Promise<void> {}

  async close(): Promise<void> {}
}

export class NoTouchDriver implements TouchDriver {
  readonly kind = "touch" as const;
  readonly id = "none";

  async status(): Promise<DriverStatus> {
    return status(this.kind, this.id, true, "Touch input is disabled");
  }

  async read(): Promise<TouchPoint | null> {
    return null;
  }

  async close(): Promise<void> {}
}

export class NoAudioDriver implements AudioDriver {
  readonly kind = "audio" as const;
  readonly id = "none";

  async status(): Promise<DriverStatus> {
    return status(this.kind, this.id, true, "Audio input/output is disabled");
  }

  async *capture(): AsyncIterable<AudioChunk> {}

  async play(_chunk: AudioChunk): Promise<void> {}

  async stopPlayback(): Promise<void> {}

  async close(): Promise<void> {}
}

export class VirtualLedDriver implements LedDriver {
  readonly kind = "led" as const;
  readonly id = "virtual";
  #state: LedState = { effect: "off", intensity: 0 };

  async status(): Promise<DriverStatus> {
    return status(
      this.kind,
      this.id,
      true,
      `Virtual LED effect: ${this.#state.effect}`,
    );
  }

  async set(state: LedState): Promise<void> {
    if (
      !Number.isFinite(state.intensity) ||
      state.intensity < 0 ||
      state.intensity > 1
    ) {
      throw new RangeError("LED intensity must be between 0 and 1");
    }
    this.#state = { ...state };
  }

  snapshot(): LedState {
    return { ...this.#state };
  }

  async close(): Promise<void> {}
}

export const createHeadlessDeviceDrivers = (): DeviceDrivers => ({
  display: new HeadlessDisplayDriver(),
  touch: new NoTouchDriver(),
  audio: new NoAudioDriver(),
  led: new VirtualLedDriver(),
});
