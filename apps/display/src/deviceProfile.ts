export type Rect = { x: number; y: number; width: number; height: number };

export type VisibleRegion =
  | ({ shape: "rectangle" } & Rect)
  | ({ shape: "rounded_rectangle"; radius: number } & Rect)
  | { shape: "circle"; centerX: number; centerY: number; radius: number };

export type DeviceProfile = {
  schema: "totem.device-profile/v0";
  id: string;
  name: string;
  display:
    | { present: false }
    | {
        present: true;
        panel: { nativeWidth: number; nativeHeight: number };
        logicalSize: { width: number; height: number };
        visibleRegion: VisibleRegion;
        contentSafeArea: Rect;
        scaleMode: "contain";
      };
  touch:
    | { present: false }
    | {
        present: true;
        sourceSize: { width: number; height: number };
        transform: { rotation: 0 | 90 | 180 | 270; mirrorX: boolean; mirrorY: boolean };
        rejectOutsideVisibleRegion: boolean;
      };
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

export function validateDeviceProfile(value: unknown): DeviceProfile {
  if (!value || typeof value !== "object") throw new Error("Profile must be an object");
  const profile = value as DeviceProfile;
  if (profile.schema !== "totem.device-profile/v0") throw new Error("Unsupported device profile schema");
  if (!profile.id || !profile.name) throw new Error("Profile id and name are required");
  if (!profile.display || !profile.touch || !profile.lighting) throw new Error("Display, touch, and lighting capabilities are required");

  if (profile.display.present) {
    const { logicalSize, visibleRegion, contentSafeArea, panel } = profile.display;
    if (!positive(panel.nativeWidth) || !positive(panel.nativeHeight)) throw new Error("Panel dimensions must be positive");
    if (!positive(logicalSize.width) || !positive(logicalSize.height)) throw new Error("Logical dimensions must be positive");
    if (profile.display.scaleMode !== "contain") throw new Error("Only contain scaling is supported in v0");

    if (visibleRegion.shape === "circle") {
      if (!positive(visibleRegion.radius)) throw new Error("Circle radius must be positive");
      if (
        visibleRegion.centerX - visibleRegion.radius < 0 ||
        visibleRegion.centerY - visibleRegion.radius < 0 ||
        visibleRegion.centerX + visibleRegion.radius > logicalSize.width ||
        visibleRegion.centerY + visibleRegion.radius > logicalSize.height
      ) throw new Error("Circle visible region must fit in logical bounds");
    } else {
      if (![visibleRegion.x, visibleRegion.y].every(nonNegative) || !positive(visibleRegion.width) || !positive(visibleRegion.height)) {
        throw new Error("Visible rectangle geometry is invalid");
      }
      if (visibleRegion.x + visibleRegion.width > logicalSize.width || visibleRegion.y + visibleRegion.height > logicalSize.height) {
        throw new Error("Visible region must fit in logical bounds");
      }
      if (visibleRegion.shape === "rounded_rectangle" && (!nonNegative(visibleRegion.radius) || visibleRegion.radius > Math.min(visibleRegion.width, visibleRegion.height) / 2)) {
        throw new Error("Rounded rectangle radius is invalid");
      }
    }

    if (![contentSafeArea.x, contentSafeArea.y].every(nonNegative) || !positive(contentSafeArea.width) || !positive(contentSafeArea.height)) {
      throw new Error("Content safe area is invalid");
    }
    if (
      contentSafeArea.x + contentSafeArea.width > logicalSize.width ||
      contentSafeArea.y + contentSafeArea.height > logicalSize.height ||
      !rectInsideVisible(visibleRegion, contentSafeArea)
    ) throw new Error("Content safe area must fit entirely inside the visible region");
  }

  if (profile.touch.present) {
    if (!positive(profile.touch.sourceSize.width) || !positive(profile.touch.sourceSize.height)) throw new Error("Touch source dimensions must be positive");
    if (![0, 90, 180, 270].includes(profile.touch.transform.rotation)) throw new Error("Touch rotation is invalid");
  }

  const ids = new Set<string>();
  for (const zone of profile.lighting.zones) {
    if (!zone.id || ids.has(zone.id)) throw new Error("Lighting zone ids must be unique and non-empty");
    ids.add(zone.id);
    if (zone.pixelCount !== undefined && (!Number.isInteger(zone.pixelCount) || zone.pixelCount <= 0)) throw new Error("Lighting pixelCount must be a positive integer");
  }

  return profile;
}

export function visibleRegionClipPath(region: VisibleRegion): string {
  if (region.shape === "circle") return `circle(${region.radius}px at ${region.centerX}px ${region.centerY}px)`;
  if (region.shape === "rounded_rectangle") return `inset(${region.y}px ${region.x}px round ${region.radius}px)`;
  return `inset(${region.y}px ${region.x}px)`;
}
