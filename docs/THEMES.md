# Themes

Themes change Totem's **identity and presentation**, not its capabilities.

A theme may define:

- color/palette tokens
- fonts and iconography
- screen layouts and ambient scenes
- animations and transitions
- sound effects
- LED patterns
- persona/system-prompt fragments
- wake-word presentation/configuration hooks
- TTS voice configuration/model references
- speech style defaults

A theme must not grant new service, filesystem, shell, network, or root capabilities.

## Why this boundary exists

Keeping themes separate allows the public project to remain generic while private users create highly specific assistants. Character/franchise-specific art, dialogue, trained voice models, or other restricted assets can remain entirely local/private.

The public Totem runtime should never depend on a particular private theme.

## Theme package

A future package may resemble:

```text
theme/
├── totem-theme.yaml
├── assets/
├── display/
├── sounds/
├── persona/
├── speech/
└── README.md
```

The exact schema belongs to `totem-theme-sdk` and is not frozen before v1.

## Phase 1 discovery stub

Phase 1 intentionally uses a minimal local discovery contract before the full theme SDK exists. The normative stub contract is [DISCOVERY.md](DISCOVERY.md).

For Phase 1 only, local theme candidates use `totem-theme.json` with schema id `totem.theme/v0`, stable identity/version fields, optional enablement metadata, and presentation asset roots. Theme stubs are forbidden from requesting permissions/capabilities such as filesystem, network, shell, secrets, MCP, agent tools, or system access.

Malformed or privilege-requesting theme candidates fail validation individually without taking down Totem. The runtime falls back to an enabled valid `default` theme when available, otherwise to a built-in generic fallback presentation.

The full public theme manifest, compatibility policy, hot-switch transaction semantics, registry/install behavior, and richer presentation schema remain deferred.

## Voice references

A theme may point to a locally installed TTS model or voice pack. Large/private models should not need to live inside the theme repository itself; manifests should be able to reference managed local assets in Totem storage.

## Safe defaults

If a theme is incomplete or fails validation, Totem should fall back to the default theme rather than fail to boot. The core also retains a built-in generic fallback presentation so recovery does not depend on any external package.

## Hot switching

The runtime should ultimately support changing themes without restarting the core. Display, LED, persona, sound, and TTS configuration should update as one coherent theme transaction.
