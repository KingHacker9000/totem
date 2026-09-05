# Storage

Totem separates application code from persistent user data.

## Development

On a PC, Totem should use a normal configurable data directory. The simulator must not depend on Raspberry-Pi-specific filesystem paths.

## Raspberry Pi target

The eventual Pi 5 deployment may boot from normal Pi storage while large/persistent Totem data lives on an externally connected HDD. The enclosure should expose rear I/O rather than requiring the HDD to fit inside the device.

A future Linux layout may resemble:

```text
/srv/totem/
├── extensions/
├── themes/
├── voices/
├── models/
├── tasks/
├── extension-data/
├── cache/
├── logs/
└── backups/
```

This is a conceptual layout, not a frozen path.

## Storage classes

Totem should distinguish:

- configuration
- secrets
- extension/theme packages
- large local assets/models
- persistent task/session state
- extension-owned data
- caches
- logs/audit history
- optional recordings
- backups

Each class should have explicit retention/backup semantics.

## External drive behavior

When external storage is unavailable, Totem should fail gracefully: the core/dashboard should still explain the problem rather than crash-loop. Extensions depending on missing storage may be disabled or degraded until it returns.

## Portability

Persistent data formats should be versioned. Replacing the Pi or reinstalling the OS should not require losing themes, extensions, settings, task history, or locally managed voice assets when the external data drive remains intact.
