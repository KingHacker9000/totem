export type Rect = { x: number; y: number; width: number; height: number };

export type VisibleRegion =
  | ({ shape: "rectangle" } & Rect)
  | ({ shape: "rounded_rectangle"; radius: number } & Rect)
  | { shape: "circle"; centerX: number; centerY: number; radius: number };

export type Size = { width: number; height: number };

export type TouchTransform = {
  rotation: 0 | 90 | 180 | 270;
  mirrorX: boolean;
  mirrorY: boolean;
  calibration?: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
};

export type TouchCapability =
  | { present: false }
  | {
      present: true;
      sourceSize: Size;
      transform: TouchTransform;
      rejectOutsideVisibleRegion: boolean;
    };

export type DeviceProfile = {
  schema: "totem.device-profile/v0";
  id: string;
  name: string;
  display:
    | { present: false }
    | {
        present: true;
        panel: { nativeWidth: number; nativeHeight: number };
        logicalSize: Size;
        visibleRegion: VisibleRegion;
        contentSafeArea: Rect;
        scaleMode: "contain";
      };
  touch: TouchCapability;
  lighting: {
    mode: "none" | "virtual" | "hardware";
    zones: Array<{
      id: string;
      kind: "ring" | "strip" | "indicator" | "panel" | "generic";
      pixelCount?: number;
      supportsRgb: boolean;
      supportsBrightness: boolean;
    }>;
  };
};

const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const nonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

export function pointInVisibleRegion(region: VisibleRegion, x: number, y: number): boolean {
  if (region.shape === "circle") {
    const dx = x - region.centerX;
    const dy = y - region.centerY;
    return dx * dx + dy * dy <= region.radius * region.radius;
  }

  if (x < region.x || y < region.y || x > region.x + region.width || y > region.y + region.height) {
    return false;
  }

  if (region.shape === "rectangle" || region.radius === 0) return true;

  const radius = region.radius;
  const innerLeft = region.x + radius;
  const innerRight = region.x + region.width - radius;
  const innerTop = region.y + radius;
  const innerBottom = region.y + region.height - radius;
  if ((x >= innerLeft && x <= innerRight) || (y >= innerTop && y <= innerBottom)) return true;

  const cornerX = x < innerLeft ? innerLeft : innerRight;
  const cornerY = y < innerTop ? innerTop : innerBottom;
  const dx = x - cornerX;
  const dy = y - cornerY;
  return dx * dx + dy * dy <= radius * radius;
}

function rectInsideVisible(region: VisibleRegion, rect: Rect): boolean {
  return [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x, rect.y + rect.height],
    [rect.x + rect.width, rect.y + rect.height],
  ].every(([x, y]) => pointInVisibleRegion(region, x, y));
}

export function mapTouchPoint(
  sourceX: number,
  sourceY: number,
  touch: Extract<TouchCapability, { present: true }>,
  logicalSize: Size,
): { x: number; y: number } {
  const calibration = touch.transform.calibration;
  const minX = calibration?.minX ?? 0;
  const maxX = calibration?.maxX ?? touch.sourceSize.width;
  const minY = calibration?.minY ?? 0;
  const maxY = calibration?.maxY ?? touch.sourceSize.height;

  let x = (sourceX - minX) / (maxX - minX);
  let y = (sourceY - minY) / (maxY - minY);

  switch (touch.transform.rotation) {
    case 90:
      [x, y] = [1 - y, x];
      break;
    case 180:
      x = 1 - x;
      y = 1 - y;
      break;
    case 270:
      [x, y] = [y, 1 - x];
      break;
  }

  if (touch.transform.mirrorX) x = 1 - x;
  if (touch.transform.mirrorY) y = 1 - y;

  return { x: x * logicalSize.width, y: y * logicalSize.height };
}

export function validateDeviceProfile(value: unknown): DeviceProfile {
  if (!value || typeof value !== "object") throw new Error("Profile must be an object");
  const profile = value as DeviceProfile;
  if (profile.schema !== "totem.device-profile/v0") throw new Error("Unsupported device profile schema");
  if (!profile.id || !profile.name) throw new Error("Profile id and name are required");
  if (!profile.display || !profile.touch || !profile.lighting) {
    throw new Error("Display, touch, and lighting capabilities are required");
  }

  if (profile.display.present) {
    const { logicalSize, visibleRegion, contentSafeArea, panel } = profile.display;
    if (!positive(panel.nativeWidth) || !positive(panel.nativeHeight)) {
      throw new Error("Panel dimensions must be positive");
    }
    if (!positive(logicalSize.width) || !positive(logicalSize.height)) {
      throw new Error("Logical dimensions must be positive");
    }
    if (profile.display.scaleMode !== "contain") throw new Error("Only contain scaling is supported in v0");

    if (visibleRegion.shape === "circle") {
      if (!positive(visibleRegion.radius)) throw new Error("Circle radius must be positive");
      if (
        visibleRegion.centerX - visibleRegion.radius < 0 ||
        visibleRegion.centerY - visibleRegion.radius < 0 ||
        visibleRegion.centerX + visibleRegion.radius > logicalSize.width ||
        visibleRegion.centerY + visibleRegion.radius > logicalSize.height
      ) {
        throw new Error("Circle visible region must fit in logical bounds");
      }
    } else {
      if (
        ![visibleRegion.x, visibleRegion.y].every(nonNegative) ||
        !positive(visibleRegion.width) ||
        !positive(visibleRegion.height)
      ) {
        throw new Error("Visible rectangle geometry is invalid");
      }
      if (
        visibleRegion.x + visibleRegion.width > logicalSize.width ||
        visibleRegion.y + visibleRegion.height > logicalSize.height
      ) {
        throw new Error("Visible region must fit in logical bounds");
      }
      if (
        visibleRegion.shape === "rounded_rectangle" &&
        (!nonNegative(visibleRegion.radius) ||
          visibleRegion.radius > Math.min(visibleRegion.width, visibleRegion.height) / 2)
      ) {
        throw new Error("Rounded rectangle radius is invalid");
      }
    }

    if (
      ![contentSafeArea.x, contentSafeArea.y].every(nonNegative) ||
      !positive(contentSafeArea.width) ||
      !positive(contentSafeArea.height)
    ) {
      throw new Error("Content safe area is invalid");
    }
    if (
      contentSafeArea.x + contentSafeArea.width > logicalSize.width ||
      contentSafeArea.y + contentSafeArea.height > logicalSize.height ||
      !rectInsideVisible(visibleRegion, contentSafeArea)
    ) {
      throw new Error("Content safe area must fit entirely inside the visible region");
    }
  }

  if (profile.touch.present) {
    if (!positive(profile.touch.sourceSize.width) || !positive(profile.touch.sourceSize.height)) {
      throw new Error("Touch source dimensions must be positive");
    }
    if (![0, 90, 180, 270].includes(profile.touch.transform.rotation)) {
      throw new Error("Touch rotation is invalid");
    }
    const calibration = profile.touch.transform.calibration;
    if (
      calibration &&
      (!Number.isFinite(calibration.minX) ||
        !Number.isFinite(calibration.maxX) ||
        !Number.isFinite(calibration.minY) ||
        !Number.isFinite(calibration.maxY) ||
        calibration.maxX <= calibration.minX ||
        calibration.maxY <= calibration.minY)
    ) {
      throw new Error("Touch calibration ranges are invalid");
    }
  }

  const ids = new Set<string>();
  for (const zone of profile.lighting.zones) {
    if (!zone.id || ids.has(zone.id)) throw new Error("Lighting zone ids must be unique and non-empty");
    ids.add(zone.id);
    if (zone.pixelCount !== undefined && (!Number.isInteger(zone.pixelCount) || zone.pixelCount <= 0)) {
      throw new Error("Lighting pixelCount must be a positive integer");
    }
  }

  return profile;
}

export function visibleRegionClipPath(region: VisibleRegion, logicalSize: Size): string {
  if (region.shape === "circle") {
    return `circle(${region.radius}px at ${region.centerX}px ${region.centerY}px)`;
  }

  const right = logicalSize.width - region.x - region.width;
  const bottom = logicalSize.height - region.y - region.height;
  const inset = `${region.y}px ${right}px ${bottom}px ${region.x}px`;
  return region.shape === "rounded_rectangle" ? `inset(${inset} round ${region.radius}px)` : `inset(${inset})`;
}
