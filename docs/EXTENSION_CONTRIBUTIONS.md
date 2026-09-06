# Extension contribution rendering

Totem renders extension-owned dashboard and display contributions through one generic core snapshot. Product UIs do not switch on extension IDs or import first-party extension code. Dashboard and display hosts consume the same snapshot contract.

## Declaration

An extension may declare contribution descriptors in its `totem.extension/v0` manifest:

```json
{
  "contributions": {
    "dashboard": [{ "id": "weather", "title": "Weather" }],
    "display": [{ "id": "weather", "title": "Weather" }]
  }
}
```

Each contribution ID is local to its owning extension. Core attaches the extension ID and lifecycle state before exposing a contribution to a UI host.

## Presentation data

A backend instance may expose the optional read-only method:

```ts
contributionSnapshot(): unknown | Promise<unknown>
```

The result must be structured-cloneable presentation data and must not contain secret values. Core owns rendering; extensions do not inject arbitrary React/HTML/JavaScript into the dashboard or display process.

`GET /api/extensions/contributions` returns the currently mountable `dashboard` and `display` views. Disabled or failed extensions are omitted. If a contribution snapshot throws, the failure is isolated to that extension and the UI entry is removed on the same refresh.

## Security

Dashboard contribution metadata is an unprivileged management/presentation surface. A display contribution is exposed only when the extension both requests and receives the effective `display.present` permission. Declaring a display contribution never grants that permission.

Backend loading still uses the normal extension lifecycle and permission boundary. A missing grant therefore cannot be bypassed through contribution rendering. Secret values remain behind the secret broker and must never be placed in a contribution snapshot.

## Display geometry

The display simulator mounts contribution content only inside the active device profile's `contentSafeArea` and clips the logical panel to its declared visible region. Headless profiles render no display contribution surface.

The developer display host is available at `/contributions` on the display app. It intentionally renders generic cards rather than extension-specific components so first-party packages exercise the same contract as third-party packages.

## Dashboard host

The dashboard exposes `/contributions`. It polls the same core snapshot and renders generic structured data cards. There is no extension-ID routing table. Disabling or failing an extension removes its card on refresh.

## First-party fixtures

Clock, weather, timer, and system-status expose `contributionSnapshot()` from their existing backend data models and declare both dashboard and display surfaces. Their display declarations request `display.present`; Totem's default grant policy remains deny, so a configured effective grant is required before they can appear on the display host.
