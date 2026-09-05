# Display and simulator

The display system must be hardware-agnostic from day one.

The normative Phase 1 device/display geometry contract is [DEVICE_PROFILE.md](DEVICE_PROFILE.md). This document describes how the display system uses that contract.

## Development target

Phase 1 runs entirely on a normal PC. The display client doubles as a device simulator so the software can be designed before buying a touchscreen or building the enclosure.

The simulator should support:

- configurable panel and logical resolution
- configurable visible region and content-safe area
- circle/rounded-rectangle/rectangle masks
- mouse-as-touch input through the normal touch mapping path
- optional touch/headless profiles
- virtual LED visualization
- scene priority/debug overlays
- theme switching
- extension view previews
- responsive browser/window scaling without changing logical coordinates

## Physical display assumption

Totem must **not** assume a genuinely circular LCD. A cheap rectangular or square touchscreen can be physically masked by the enclosure so only a circular region is visible.

A device profile therefore describes these separately:

- the physical/native rectangular panel dimensions;
- the logical rendering coordinate system;
- the visible region (`rectangle`, `rounded_rectangle`, or `circle`);
- an axis-aligned content-safe area that is guaranteed to be visible;
- optional touch input and its transform;
- optional virtual/physical lighting capabilities.

For example, an 800x480 rectangular touchscreen behind a circular bezel remains an 800x480 panel in the profile. Only its `visibleRegion` is circular. See [DEVICE_PROFILE.md](DEVICE_PROFILE.md) for the exact `totem.device-profile/v0` schema, validation rules, touch mapping semantics, and PC/Pi examples.

## Visible region vs content-safe area

The **visible region** is the final clipping boundary corresponding to what the user can physically see. Themes may use it for decorative/full-bleed rendering.

The **content-safe area** is the conservative rectangle intended for required controls, text, status, and ordinary extension UI. Core UI and ordinary extension views keep required content inside it so a basic extension does not need to understand circular geometry.

A future shape-aware UI SDK may let extensions deliberately use more of the visible region. Hidden panel pixels are never valid product UI just because the underlying LCD contains them.

## Scene model

Views should not replace each other directly. They request screen ownership from the display manager with attributes such as:

- priority
- duration/timeout
- interruptible
- ambient vs transient
- restore_previous
- interaction mode

Examples:

```text
screensaver/ambient      low
music/weather            normal
assistant response       elevated
notification             high
timer/alarm              higher
critical system state    highest
```

Exact numeric priorities belong in the implementation rather than this document.

## Touch

Touch is optional. Every core flow must remain operable through voice and the dashboard. Themes/extensions may enhance their views with touch controls when a touch-capable profile is present.

The v0 profile maps a touch source into logical display coordinates using optional calibration plus 0/90/180/270-degree rotation and mirroring. A masked rectangular touchscreen should reject mapped touches outside the declared visible region so hidden pixels do not remain interactive.

Mouse/pointer input in simulator mode should enter the same logical interaction path rather than using simulator-only UI semantics.

## Headless operation

A valid Totem device profile may declare no display and no touch. Display scenes can still exist as semantic state for logs, remote/dashboard inspection, and future device attachment, but the absence of a local display must not break core task or agent workflows.

## Lighting

Device profiles describe lighting semantically as absent, virtual, or hardware-backed zones. They do not expose GPIO pins, LED protocols, microcontroller commands, or other low-level hardware details to themes/extensions.

The simulator visualizes virtual zones; future Pi hardware maps the same semantic zones to physical drivers.

## Theme interaction

Themes own visual tokens, transitions, ambient scenes, animation language, and semantic lighting presentation. Extensions own semantic content. Extension views should consume theme tokens/components instead of hard-coding a visual identity.

Themes may use the full visible region for decorative rendering but do not redefine the device profile, physical panel, touch calibration, or hardware capability boundaries.
