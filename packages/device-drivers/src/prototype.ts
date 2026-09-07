import { access, readFile } from "node:fs/promises";

export type PrototypeCapability =
  | "display"
  | "touch"
  | "audio.capture"
  | "audio.playback"
  | "led"
  | "controls.wake"
  | "controls.service"
  | "privacy.mute"
  | "telemetry.thermal";

export interface PrototypeCapabilityStatus {
  capability: PrototypeCapability;
  available: boolean;
  backend: string;
  detail: string;
}

export interface HardwareProbeIo {
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string | null>;
}

export interface PrototypeProbePaths {
  drmCard: string;
  touchInputRoot: string;
  alsaCards: string;
  gpioChip: string;
  thermalZone: string;
}

export const DEFAULT_PROTOTYPE_PROBE_PATHS: PrototypeProbePaths = {
  drmCard: "/dev/dri/card0",
  touchInputRoot: "/dev/input",
  alsaCards: "/proc/asound/cards",
  gpioChip: "/dev/gpiochip0",
  thermalZone: "/sys/class/thermal/thermal_zone0/temp",
};

export const nodeHardwareProbeIo: HardwareProbeIo = {
  async exists(path) {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  },
  async readText(path) {
    try {
      return await readFile(path, "utf8");
    } catch {
      return null;
    }
  },
};

const capability = (
  capabilityName: PrototypeCapability,
  available: boolean,
  backend: string,
  detail: string,
): PrototypeCapabilityStatus => ({
  capability: capabilityName,
  available,
  backend,
  detail,
});

export const probePrototypeHardware = async (
  io: HardwareProbeIo = nodeHardwareProbeIo,
  paths: PrototypeProbePaths = DEFAULT_PROTOTYPE_PROBE_PATHS,
): Promise<PrototypeCapabilityStatus[]> => {
  const [display, touch, gpio, thermal, alsaText] = await Promise.all([
    io.exists(paths.drmCard),
    io.exists(paths.touchInputRoot),
    io.exists(paths.gpioChip),
    io.exists(paths.thermalZone),
    io.readText(paths.alsaCards),
  ]);
  const audio =
    alsaText !== null && /respeaker|seeed|xu316/i.test(alsaText.toLowerCase());

  return [
    capability(
      "display",
      display,
      "linux-drm",
      display ? "DRM display device is present" : `Missing ${paths.drmCard}`,
    ),
    capability(
      "touch",
      touch,
      "linux-evdev",
      touch
        ? "Linux input subsystem is present; identify Touch Display 2 during device-present validation"
        : `Missing ${paths.touchInputRoot}`,
    ),
    capability(
      "audio.capture",
      audio,
      "alsa-usb-audio",
      audio
        ? "reSpeaker/Seeed/XU316 ALSA card detected"
        : "reSpeaker Lite is not present in /proc/asound/cards",
    ),
    capability(
      "audio.playback",
      audio,
      "alsa-usb-audio",
      audio
        ? "reSpeaker/Seeed/XU316 ALSA card detected"
        : "reSpeaker Lite is not present in /proc/asound/cards",
    ),
    capability(
      "led",
      gpio,
      "gpio12-level-shifted-ws2812",
      gpio
        ? "GPIO controller is present; pixel timing remains a device-present backend check"
        : `Missing ${paths.gpioChip}`,
    ),
    capability(
      "controls.wake",
      gpio,
      "gpio5-active-low",
      gpio ? "GPIO controller is present" : `Missing ${paths.gpioChip}`,
    ),
    capability(
      "controls.service",
      gpio,
      "gpio6-active-low",
      gpio ? "GPIO controller is present" : `Missing ${paths.gpioChip}`,
    ),
    capability(
      "privacy.mute",
      gpio,
      "gpio16-active-low-fail-closed",
      gpio
        ? "GPIO controller is present; physical mute state must be authoritative"
        : `Missing ${paths.gpioChip}; microphone capture must remain disabled when privacy state is unknown`,
    ),
    capability(
      "telemetry.thermal",
      thermal,
      "linux-thermal-zone",
      thermal
        ? "CPU thermal telemetry is present"
        : `Missing ${paths.thermalZone}`,
    ),
  ];
};

export type PrototypeControl = "wake" | "service" | "privacy-mute";

export interface ControlSnapshot {
  wakePressed: boolean;
  servicePressed: boolean;
  privacyMuted: boolean;
}

export interface ControlDriver {
  status(): Promise<{ available: boolean; detail: string }>;
  read(): Promise<ControlSnapshot>;
}

export class SimulatedControlDriver implements ControlDriver {
  #state: ControlSnapshot;

  constructor(initial: Partial<ControlSnapshot> = {}) {
    this.#state = {
      wakePressed: false,
      servicePressed: false,
      privacyMuted: true,
      ...initial,
    };
  }

  async status(): Promise<{ available: boolean; detail: string }> {
    return { available: true, detail: "Simulated prototype controls" };
  }

  async read(): Promise<ControlSnapshot> {
    return { ...this.#state };
  }

  set(control: PrototypeControl, active: boolean): void {
    if (control === "wake") this.#state.wakePressed = active;
    if (control === "service") this.#state.servicePressed = active;
    if (control === "privacy-mute") this.#state.privacyMuted = active;
  }
}

export interface ThermalSnapshot {
  cpuTemperatureC: number | null;
  throttled: boolean | null;
  undervoltage: boolean | null;
}

export interface TelemetryDriver {
  status(): Promise<{ available: boolean; detail: string }>;
  read(): Promise<ThermalSnapshot>;
}

export class SimulatedTelemetryDriver implements TelemetryDriver {
  #state: ThermalSnapshot;

  constructor(initial: Partial<ThermalSnapshot> = {}) {
    this.#state = {
      cpuTemperatureC: null,
      throttled: null,
      undervoltage: null,
      ...initial,
    };
  }

  async status(): Promise<{ available: boolean; detail: string }> {
    return { available: true, detail: "Simulated Pi telemetry" };
  }

  async read(): Promise<ThermalSnapshot> {
    return { ...this.#state };
  }

  set(next: Partial<ThermalSnapshot>): void {
    this.#state = { ...this.#state, ...next };
  }
}

export const microphoneCaptureAllowed = (
  privacyStateKnown: boolean,
  privacyMuted: boolean,
  softwareMuted: boolean,
): boolean => privacyStateKnown && !privacyMuted && !softwareMuted;
