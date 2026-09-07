import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROTOTYPE_PROBE_PATHS,
  SimulatedControlDriver,
  SimulatedTelemetryDriver,
  microphoneCaptureAllowed,
  probePrototypeHardware,
  type HardwareProbeIo,
} from "./prototype.js";

const fakeIo = (
  existing: string[],
  files: Record<string, string> = {},
): HardwareProbeIo => ({
  async exists(path) {
    return existing.includes(path);
  },
  async readText(path) {
    return files[path] ?? null;
  },
});

describe("prototype hardware capability detection", () => {
  it("reports absent hardware explicitly and fails privacy closed", async () => {
    const statuses = await probePrototypeHardware(fakeIo([]));

    expect(statuses).toHaveLength(9);
    expect(statuses.every((status) => !status.available)).toBe(true);
    expect(
      statuses.find((status) => status.capability === "privacy.mute")?.detail,
    ).toContain("capture must remain disabled");
    expect(microphoneCaptureAllowed(false, false, false)).toBe(false);
  });

  it("maps the frozen prototype interfaces when Linux capabilities exist", async () => {
    const paths = DEFAULT_PROTOTYPE_PROBE_PATHS;
    const statuses = await probePrototypeHardware(
      fakeIo(
        [
          paths.drmCard,
          paths.touchInputRoot,
          paths.gpioChip,
          paths.thermalZone,
        ],
        {
          [paths.alsaCards]: " 2 [seeed2micvoicec]: USB-Audio - reSpeaker Lite XU316",
        },
      ),
    );

    expect(statuses.every((status) => status.available)).toBe(true);
    expect(
      statuses.find((status) => status.capability === "controls.wake")?.backend,
    ).toBe("gpio5-active-low");
    expect(
      statuses.find((status) => status.capability === "led")?.backend,
    ).toBe("gpio12-level-shifted-ws2812");
  });
});

describe("simulated prototype adapters", () => {
  it("keeps physical privacy mute authoritative", async () => {
    const controls = new SimulatedControlDriver();
    expect((await controls.read()).privacyMuted).toBe(true);
    expect(microphoneCaptureAllowed(true, true, false)).toBe(false);

    controls.set("privacy-mute", false);
    expect((await controls.read()).privacyMuted).toBe(false);
    expect(microphoneCaptureAllowed(true, false, false)).toBe(true);
    expect(microphoneCaptureAllowed(true, false, true)).toBe(false);
  });

  it("provides deterministic telemetry without pretending hardware exists", async () => {
    const telemetry = new SimulatedTelemetryDriver({ cpuTemperatureC: 54.5 });
    expect(await telemetry.read()).toEqual({
      cpuTemperatureC: 54.5,
      throttled: null,
      undervoltage: null,
    });

    telemetry.set({ throttled: false, undervoltage: false });
    expect(await telemetry.read()).toEqual({
      cpuTemperatureC: 54.5,
      throttled: false,
      undervoltage: false,
    });
  });
});
