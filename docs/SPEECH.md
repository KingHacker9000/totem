# Speech

Totem keeps speech local while delegating general-purpose reasoning to external agent providers.

## Pipeline

```text
microphone
   -> wake word / push-to-talk
   -> voice activity detection
   -> local speech-to-text
   -> deterministic command router OR agent broker
   -> response stream
   -> local text-to-speech
   -> speaker
```

## Phase 1/PC development

Speech is developed on the user's normal PC using its existing microphone and speakers. The Pi does not need audio hardware during the software phases.

Keyboard input must remain available as a first-class development path so speech can be bypassed while debugging.

## Local-only components

The intended on-device speech stack includes:

- wake-word detection
- VAD
- STT
- TTS
- playback control
- interruption/barge-in support
- later acoustic echo cancellation as required by the physical build

No local general-purpose LLM is required.

## Barge-in

Users must be able to interrupt speech immediately. TTS playback and active response streaming therefore need cancellable session semantics rather than fire-and-forget audio.

## Voice configuration

Voice selection belongs to theme/speech configuration, not to the assistant core. Themes may reference locally installed TTS models while the speech service provides the runtime interface.

## Privacy

Raw microphone audio should be ephemeral by default. Recording/storage must be an explicit opt-in feature with visible settings and retention controls.

## Hardware migration

When Totem later moves to Raspberry Pi 5, the software contract remains the same while audio drivers change from desktop APIs to the Pi's Linux audio stack and selected mic/speaker hardware.
