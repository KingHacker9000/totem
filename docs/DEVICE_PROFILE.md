# Device profile and display geometry contract v0

This document is the Phase 1 implementation source of truth for Totem device/display geometry, touch mapping, headless behavior, and semantic lighting capabilities.

The profile describes **what a device presents to Totem**, not how a specific framebuffer, browser, GPIO controller, touchscreen driver, or enclosure is implemented. The same contract is used by the PC simulator and later Raspberry Pi hardware.

## Core rule

A physical panel and the visible UI shape are different concepts.

A device may use an ordinary rectangular LCD while the enclosure physically exposes only a circular area. Totem therefore renders against a logical coordinate system plus an explicit visible region and content-safe area. No application, extension, or theme may infer the visible shape from the physical panel dimensions.

## Schema identity

Every profile uses:

```text
schema: totem.device-profile/v0
```

Example top-level shape:

```ts
interface DeviceProfileV0 {
  schema: "totem.device-profile/v0";
  id: string;
  name: string;
  display: DisplayCapability;
  touch: TouchCapability;
  lighting: LightingCapability;
}
```

`id` is a stable machine-readable profile id such as `simulator-circle-800x480`. `name` is human-readable.

## Coordinate system

All UI geometry uses **logical pixels**:

- origin `(0, 0)` is the top-left of the logical display;
- positive `x` moves right;
- positive `y` moves down;
- geometry values are finite non-negative numbers;
- the logical display bounds are `[0, width] x [0, height]`;
- browser/window scaling does not change logical coordinates.

The simulator may draw the logical display at any CSS size. Future hardware drivers may map logical pixels to native framebuffer pixels. UI code must never use simulator-window size as device geometry.

## Display capability

A display-capable device declares:

```ts
type DisplayCapability =
  | {
      present: false;
    }
  | {
      present: true;
      panel: {
        nativeWidth: number;
        nativeHeight: number;
        physicalWidthMm?: number;
        physicalHeightMm?: number;
      };
      logicalSize: {
        width: number;
        height: number;
      };
      visibleRegion: VisibleRegion;
      contentSafeArea: Rect;
      scaleMode: "contain";
    };
```

`panel.nativeWidth` and `panel.nativeHeight` describe the actual panel/framebuffer pixel dimensions. Optional physical millimetres are informational for tooling and must not affect UI layout.

`logicalSize` is the coordinate system used by Totem scenes, themes, extensions, and touch events. It may equal the native panel size, but that is not required.

Phase 1 supports only `scaleMode: "contain"`: logical content is uniformly scaled and centered when mapped to a differently sized native/window surface. Aspect ratio is preserved. Stretching is not part of v0.

A headless device uses `display.present: false`; display geometry fields are then absent.

## Visible region

The visible region is the portion of the logical surface a user can physically see.

```ts
type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type VisibleRegion =
  | {
      shape: "rectangle";
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | {
      shape: "rounded_rectangle";
      x: number;
      y: number;
      width: number;
      height: number;
      radius: number;
    }
  | {
      shape: "circle";
      centerX: number;
      centerY: number;
      radius: number;
    };
```

The visible region must fit entirely inside `logicalSize`.

The renderer clips final device output to the visible region. In simulator mode, the hidden portion of the rectangular panel should remain inspectable through a debug overlay, but it is not considered visible product UI.

### Circular mask rule

For a circular physical bezel over a rectangular LCD, the profile still reports the real rectangular `panel.nativeWidth/nativeHeight`. Only `visibleRegion.shape` is `circle`.

For example, an 800x480 panel with a 430-pixel visible circular opening is represented as:

```yaml
display:
  present: true
  panel:
    nativeWidth: 800
    nativeHeight: 480
  logicalSize:
    width: 800
    height: 480
  visibleRegion:
    shape: circle
    centerX: 400
    centerY: 240
    radius: 215
```

Nothing in this profile says that the LCD itself is circular.

## Content-safe area

`contentSafeArea` is an axis-aligned logical rectangle guaranteed to be fully visible and suitable for ordinary text, controls, extension content, and accessibility-critical UI.

```ts
contentSafeArea: {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

Validation requires the complete safe rectangle to lie inside both the logical display bounds and the visible region.

### Safe-area contract for themes and extensions

- Core UI and ordinary extension views must keep required text, controls, status, and interaction targets inside `contentSafeArea`.
- Themes may render decorative/full-bleed visuals throughout `visibleRegion`; those visuals are clipped by the renderer.
- An extension may deliberately render outside `contentSafeArea` only when using a shape-aware/full-bleed surface contract introduced by a later UI SDK. It must never assume hidden panel pixels are visible.
- Touch targets required to complete a user flow must be inside `contentSafeArea` unless the view explicitly uses a future shape-aware interaction contract.
- The safe area is a **guarantee**, not a mandatory clipping mask for backgrounds or ambient animation.

For a circular display opening, the safe area will usually be an inscribed rectangle smaller than the circle. This deliberately makes basic extension UI usable without every extension implementing circular geometry.

## Touch capability

Touch is optional and independent of display presence.

```ts
type TouchCapability =
  | {
      present: false;
    }
  | {
      present: true;
      sourceSize: {
        width: number;
        height: number;
      };
      transform: {
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
      rejectOutsideVisibleRegion: boolean;
    };
```

`sourceSize` describes the coordinate range emitted by the touch source before mapping to Totem logical coordinates. In PC simulator mode this may simply equal the logical display size and mouse/pointer input acts as touch.

The transform is applied in this order:

1. optional calibration range normalization;
2. rotation;
3. mirroring;
4. mapping into logical display coordinates.

Phase 1 supports only the discrete transforms above. A later hardware phase may extend the contract with an affine calibration matrix if real hardware proves it necessary.

### Masked-panel touch behavior

A rectangular touchscreen may report touches from pixels hidden behind a circular bezel. Profiles for that hardware should set:

```yaml
rejectOutsideVisibleRegion: true
```

The input layer then discards mapped points outside `visibleRegion` before they reach normal UI interaction handlers.

`touch.present: false` must be a supported normal state. Core flows remain available by voice/dashboard and must not require touch.

## Lighting capability

Lighting is described semantically. Device profiles do **not** expose GPIO numbers, LED protocols, USB paths, or microcontroller commands to themes/extensions.

```ts
type LightingCapability =
  | {
      mode: "none";
      zones: [];
    }
  | {
      mode: "virtual" | "hardware";
      zones: Array<{
        id: string;
        kind: "ring" | "strip" | "indicator" | "panel" | "generic";
        pixelCount?: number;
        supportsRgb: boolean;
        supportsBrightness: boolean;
      }>;
    };
```

Examples of stable semantic zone ids are `primary`, `status`, or `accent-left`. A hardware driver maps semantic state/effects to the actual LED implementation later.

The PC simulator uses `mode: "virtual"` and visualizes the same semantic zones that a later physical driver would implement. A Pi profile uses `mode: "hardware"` only when a real lighting driver is configured.

Themes may choose colors/animations for semantic assistant states, but they do not receive raw hardware control through this profile.

## Validation invariants

A v0 profile is invalid if any of the following is true:

- `schema` is not exactly `totem.device-profile/v0`;
- an id is empty or not stable/machine-readable;
- native or logical dimensions are zero, negative, non-finite, or missing for a present display;
- `visibleRegion` crosses logical display bounds;
- rounded-rectangle radius is negative or greater than half the smaller side;
- circle radius is non-positive or the circle crosses logical display bounds;
- `contentSafeArea` crosses logical bounds or is not completely contained by `visibleRegion`;
- touch dimensions are invalid when touch is present;
- touch transform uses a rotation outside `0|90|180|270`;
- calibration maxima are not greater than minima;
- lighting zone ids are duplicated;
- `pixelCount`, when supplied, is not a positive integer.

Invalid profiles must fail clearly during load/selection. The runtime must not silently coerce invalid geometry into a different profile.

## Example A — rectangular PC simulator

```yaml
schema: totem.device-profile/v0
id: simulator-rectangle-800x480
name: PC Simulator — 800x480 Rectangle

display:
  present: true
  panel:
    nativeWidth: 800
    nativeHeight: 480
  logicalSize:
    width: 800
    height: 480
  visibleRegion:
    shape: rectangle
    x: 0
    y: 0
    width: 800
    height: 480
  contentSafeArea:
    x: 32
    y: 32
    width: 736
    height: 416
  scaleMode: contain

touch:
  present: true
  sourceSize:
    width: 800
    height: 480
  transform:
    rotation: 0
    mirrorX: false
    mirrorY: false
  rejectOutsideVisibleRegion: true

lighting:
  mode: virtual
  zones:
    - id: primary
      kind: ring
      pixelCount: 24
      supportsRgb: true
      supportsBrightness: true
```

## Example B — rounded-rectangle simulator profile

```yaml
schema: totem.device-profile/v0
id: simulator-rounded-640x640
name: PC Simulator — Rounded Square

display:
  present: true
  panel:
    nativeWidth: 640
    nativeHeight: 640
  logicalSize:
    width: 640
    height: 640
  visibleRegion:
    shape: rounded_rectangle
    x: 20
    y: 20
    width: 600
    height: 600
    radius: 72
  contentSafeArea:
    x: 64
    y: 64
    width: 512
    height: 512
  scaleMode: contain

touch:
  present: true
  sourceSize:
    width: 640
    height: 640
  transform:
    rotation: 0
    mirrorX: false
    mirrorY: false
  rejectOutsideVisibleRegion: true

lighting:
  mode: virtual
  zones:
    - id: status
      kind: strip
      supportsRgb: true
      supportsBrightness: true
```

## Example C — future Pi with rectangular touchscreen behind circular bezel

This is an architectural example, **not a selected hardware part**.

```yaml
schema: totem.device-profile/v0
id: pi-circle-mask-example-800x480
name: Pi Example — 800x480 Panel / Circular Opening

display:
  present: true
  panel:
    nativeWidth: 800
    nativeHeight: 480
  logicalSize:
    width: 800
    height: 480
  visibleRegion:
    shape: circle
    centerX: 400
    centerY: 240
    radius: 215
  contentSafeArea:
    x: 248
    y: 88
    width: 304
    height: 304
  scaleMode: contain

touch:
  present: true
  sourceSize:
    width: 800
    height: 480
  transform:
    rotation: 0
    mirrorX: false
    mirrorY: false
  rejectOutsideVisibleRegion: true

lighting:
  mode: hardware
  zones:
    - id: primary
      kind: ring
      pixelCount: 24
      supportsRgb: true
      supportsBrightness: true
```

The `304x304` safe area is intentionally conservative and entirely inside the circular opening. Actual dimensions will be derived from the selected screen and physical bezel later.

## Example D — headless Totem node/profile

```yaml
schema: totem.device-profile/v0
id: headless
name: Headless Totem

display:
  present: false

touch:
  present: false

lighting:
  mode: none
  zones: []
```

A headless profile is valid. Display scenes may still exist as semantic state, but no display renderer is required and no core workflow may fail merely because `display.present` is false.

## Simulator requirements derived from this contract

The Phase 1 simulator (T109) should:

- load profiles without source-code edits;
- render the full logical panel and visibly distinguish hidden/masked pixels in debug mode;
- clip product output to `visibleRegion`;
- optionally draw the `contentSafeArea` overlay;
- map mouse/pointer input through the same logical touch path;
- allow rectangle, rounded-rectangle, and circle-masked profiles;
- show virtual lighting zones separately from display geometry;
- continue to function when touch is disabled;
- handle a headless profile gracefully in developer tooling.

## Versioning

This is a Phase 1 `v0` contract. Breaking changes are allowed before the public SDK reaches v1, but the schema id must change when serialized semantics become incompatible. Implementations must reject unknown major/profile schema ids rather than guessing.
