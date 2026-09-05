# Display and simulator

The display system must be hardware-agnostic from day one.

## Development target

Phase 1 runs entirely on a normal PC. The display client doubles as a device simulator so the software can be designed before buying a touchscreen or building the enclosure.

The simulator should support:

- configurable panel resolution
- configurable visible safe area
- circle/rounded-rectangle/rectangle masks
- mouse-as-touch input
- virtual LED visualization
- scene priority/debug overlays
- theme switching
- extension view previews
- responsive scaling

## Physical display assumption

Totem must **not** assume a genuinely circular LCD. A cheap rectangular or square touchscreen can be physically masked by the enclosure so only a circular region is visible.

The UI therefore renders into a logical safe area independent of panel geometry.

Example device profile:

```yaml
panel:
  width: 800
  height: 480
visible_region:
  shape: circle
  center_x: 400
  center_y: 240
  diameter: 430
input:
  touch: true
```

Schema is illustrative until Phase 1.

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

## Theme interaction

Themes own visual tokens, transitions, ambient scenes, and animation language. Extensions own semantic content. Extension views should consume theme tokens/components instead of hard-coding a visual identity.
