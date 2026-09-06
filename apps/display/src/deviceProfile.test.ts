import { describe, expect, it } from "vitest";
import {
  mapTouchPoint,
  pointInVisibleRegion,
  validateDeviceProfile,
  visibleRegionClipPath,
} from "./deviceProfile";

describe("device profile geometry", () => {
  it("builds clip paths for asymmetric rectangular visible regions", () => {
    expect(
      visibleRegionClipPath(
        { shape: "rectangle", x: 10, y: 20, width: 70, height: 40 },
        { width: 100, height: 100 },
      ),
    ).toBe("inset(20px 20px 40px 10px)");
  });

  it("rejects points outside rounded corners", () => {
    const region = {
      shape: "rounded_rectangle" as const,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      radius: 20,
    };
    expect(pointInVisibleRegion(region, 2, 2)).toBe(false);
    expect(pointInVisibleRegion(region, 20, 20)).toBe(true);
  });
});

describe("touch mapping", () => {
  const logicalSize = { width: 200, height: 100 };

  it("applies rotation before mirroring", () => {
    const point = mapTouchPoint(
      25,
      20,
      {
        present: true,
        sourceSize: { width: 100, height: 100 },
        transform: { rotation: 90, mirrorX: true, mirrorY: false },
        rejectOutsideVisibleRegion: true,
      },
      logicalSize,
    );

    expect(point.x).toBeCloseTo(40);
    expect(point.y).toBeCloseTo(25);
  });

  it("normalizes calibrated source ranges", () => {
    const point = mapTouchPoint(
      60,
      45,
      {
        present: true,
        sourceSize: { width: 120, height: 90 },
        transform: {
          rotation: 0,
          mirrorX: false,
          mirrorY: false,
          calibration: { minX: 10, maxX: 110, minY: 20, maxY: 70 },
        },
        rejectOutsideVisibleRegion: true,
      },
      logicalSize,
    );

    expect(point).toEqual({ x: 100, y: 50 });
  });

  it("validates calibration ranges", () => {
    expect(() =>
      validateDeviceProfile({
        schema: "totem.device-profile/v0",
        id: "bad-calibration",
        name: "Bad calibration",
        display: { present: false },
        touch: {
          present: true,
          sourceSize: { width: 100, height: 100 },
          transform: {
            rotation: 0,
            mirrorX: false,
            mirrorY: false,
            calibration: { minX: 10, maxX: 10, minY: 0, maxY: 100 },
          },
          rejectOutsideVisibleRegion: false,
        },
        lighting: { mode: "none", zones: [] },
      }),
    ).toThrow("Touch calibration ranges are invalid");
  });
});
