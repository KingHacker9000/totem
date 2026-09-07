# Prototype v1 software bring-up

This checklist maps the frozen prototype-v1 BOM onto Totem's generic device seams without claiming that unconnected hardware has been validated. Final physical fit and device-present validation remain part of T912.

## Capability map

| Prototype capability | Generic Totem path | Linux/backend expectation | Absent-device behavior |
| --- | --- | --- | --- |
| Touch Display 2 video | `DisplayDriver` | DRM/KMS, expected `/dev/dri/card0` | capability reports unavailable; headless display remains usable |
| Touch Display 2 touch | `TouchDriver` | Linux evdev under `/dev/input` | no touch events; keyboard/operator UI remains usable |
| reSpeaker Lite capture | `AudioDriver.capture()` | USB Audio Class / ALSA card containing reSpeaker, Seeed, or XU316 identity | capture unavailable; do not silently substitute another microphone |
| reSpeaker Lite playback | `AudioDriver.play()` | same ALSA USB-audio card | playback unavailable; no fake success |
| 24-pixel status ring | `LedDriver` | GPIO12 -> 74AHCT125 -> WS2812/SK6812 DIN | semantic LED state can remain virtual; physical output reports unavailable |
| wake button | `ControlDriver` / `controls.wake` | GPIO5 active-low with pull-up | unavailable rather than synthesized |
| service button | `ControlDriver` / `controls.service` | GPIO6 active-low with pull-up | unavailable rather than synthesized |
| physical privacy switch | `ControlDriver` / `privacy.mute` | GPIO16 active-low state sense; separate hard-mute pole | **fail closed**: unknown physical privacy state blocks microphone capture |
| Pi thermal/power health | `TelemetryDriver` / `telemetry.thermal` | Linux thermal zone plus Pi throttling/undervoltage telemetry during physical validation | unknown fields remain `null`; never report a healthy value that was not observed |

`probePrototypeHardware()` provides a deterministic host-side preflight for the device paths that can be detected without opening hardware. The probe is intentionally conservative: GPIO presence does not claim that the LED ring/buttons are wired correctly, and `/dev/input` presence does not claim the Touch Display 2 is the active input device.

## Simulation contract

`SimulatedControlDriver` and `SimulatedTelemetryDriver` exist for tests, UI integration, and development without attached hardware. Simulation is explicit in `status().detail` and defaults privacy to muted. `microphoneCaptureAllowed()` requires the physical privacy state to be known and unmuted as well as software mute to be clear.

Simulation must never be selected as evidence for T912 physical acceptance.

## Smallest remaining device-present checks for T912

1. **Display/touch:** identify the actual DRM connector and Touch Display 2 evdev device; verify orientation, active region, edge behavior, reboot persistence, and UI scaling.
2. **Audio:** identify stable ALSA capture/playback endpoints for the reSpeaker Lite; verify raw capture, speaker output, simultaneous capture/playback, AEC behavior, reconnect/reboot stability, and chosen levels.
3. **Privacy:** verify GPIO16 polarity at boot and while toggling; prove that the separate hard-mute path stops host microphone content while preserving playback if intended. Totem must never enable capture while GPIO privacy state is unknown or muted.
4. **Buttons:** verify GPIO5/GPIO6 active-low polarity, pull-ups, debounce, long/short presses if used, and safe behavior when held during boot.
5. **LED ring:** verify GPIO12/level-shifter signal, color order, pixel count, data direction, and the documented 0.40 A aggregate brightness ceiling under representative effects.
6. **Thermals/power:** record CPU temperature, fan behavior, undervoltage and throttling flags under the combined display/audio/LED/CPU workload.
7. **Failure behavior:** unplug or disable each optional device independently and confirm Totem reports the capability unavailable without crashing core or silently rerouting to an unintended device.

## Guardrails

- This software mapping does not freeze any CAD dimension.
- Vendor/reference dimensions are not substitutes for T909 measured data.
- Portal/franchise-specific cosmetics do not belong in these public adapters.
- The LED current ceiling and GPIO assignments come from `totem-hardware/docs/prototype-v1-integration.md`; changing them requires reconciling that integration plan, not only software.
