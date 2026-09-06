import { describe, expect, it } from "vitest";
import { VirtualLedDriver, createHeadlessDeviceDrivers } from "./index.js";

describe("headless device drivers", () => {
  it("provides hardware-independent safe defaults", async () => {
    const drivers = createHeadlessDeviceDrivers();

    await expect(drivers.display.status()).resolves.toMatchObject({
      kind: "display",
      id: "headless",
      available: true,
    });
    await expect(drivers.touch.read()).resolves.toBeNull();
    await expect(drivers.audio.status()).resolves.toMatchObject({ id: "none", available: true });
    await expect(drivers.led.status()).resolves.toMatchObject({ id: "virtual", available: true });
  });

  it("keeps semantic LED state independent from physical controllers", async () => {
    const led = new VirtualLedDriver();
    await led.set({ effect: "pulse", intensity: 0.6, semanticColor: "attention" });

    expect(led.snapshot()).toEqual({
      effect: "pulse",
      intensity: 0.6,
      semanticColor: "attention",
    });
    await expect(led.set({ effect: "solid", intensity: 2 })).rejects.toThrow(RangeError);
  });
});
