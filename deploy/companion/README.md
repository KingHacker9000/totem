# Muse companion sidecar (Pi deployment, work in progress)

This optional deployment service owns companion semantic state, alerts and timers
beside the existing Totem core release. It does not change core, load a private
character, replace the kiosk, or embed Muse transport in core. The Muse service
uses the unmodified upstream Linux SDK with a restricted executor/registry.
Private artwork remains in the theme repository. This is an incremental adapter
for the existing Pi installation, not a new core or extension SDK contract.

Tracked by epic #109 and #93–108. The original installed idle is the visual
baseline; final visual additions must come from Claude Design. No new artwork
is shipped in this directory.

## Current boundaries

- HTTP binds to `127.0.0.1:4181`; 4180 is the existing authenticated admin.
- `GET /state`, `GET /events` (SSE), `POST /heartbeat` and `POST /command`
  require a per-process display token. SSE uses a query token; other routes use
  `X-Totem-View-Token`. The token is loaded from a local bootstrap file, never
  served over HTTP. A named ACL grants only the configured kiosk user read
  access; the Muse account cannot read it. Install distro `acl` for `setfacl`.
  Browser commands are a narrow subset, without
  generic notification injection, core restart or display restart.
- The group-protected `/run/totem-companion/commands.sock` accepts one newline
  JSON `{ "command": "totem.health", "args": {} }` per connection. Muse's
  restricted executor uses this socket. Arguments are validated in the sidecar,
  independently of the model's tool schemas.
- Muse advertises only `totem.*`: avatar state/look/reaction, notification/card,
  acknowledgement, health, focus, next/briefing, brightness and fixed recovery.
  Shell and file commands are neither registered nor executable. Idle socket
  input has a five-second limit; complete requests use the fifteen-second command
  budget so persistence/recovery work is not cut off by the idle-input timeout.
- Muse runs as `musegadget`, with no sudo and `NoNewPrivileges`. Credentials
  and identity are in `/var/lib/musegadget` (0700); companion data is owned by
  `totem-companion` on the HDD (0700). The common group permits sockets and
  transport status, not credential or application-state directory access.
- The recovery helper takes only a fixed kiosk/core unit or integer backlight
  percentage. Its root-owned path is the only sudo grant to `totem-companion`.
  No service name, shell, path, URL, reboot, deletion or network-setting tool is
  exposed to Muse.
- Core restart is unavailable by default (`TOTEM_COMPANION_APPROVALS` unset).
  When a real physical confirmation UI is integrated, opt-in allows expiring,
  single-use requests. Remote tools cannot approve their own requests. A future
  remote approval protocol must authenticate an explicit human confirmation,
  rather than trusting another model tool call.
- Auto kiosk restart is opt-in (`TOTEM_COMPANION_AUTO_RECOVER=1`) and requires
  the active original display to send fresh rendered-frame heartbeats. Keep it
  disabled on hosts without that verified integration. The inspected Pi now
  enables it through `/etc/totem-companion.env`, after a controlled frozen-kiosk
  test restored rendering without restarting core. Existing systemd crash
  restarts remain in place. Separate durable counters cap automatic attempts at
  two/hour, with startup and retry grace. Failed recovery escalates to a pinned
  alert instead of an endless restart loop. Counters survive audit eviction,
  companion restart and migration from legacy audit records.

## State and delivery

`state.json` is atomically replaced and flushed on the HDD, with a flushed backup. Invalid state is preserved and a backup restored, or a fresh state used with a persistent recovery notice. Persistent events, acknowledgements,
focus timers, outbox, delivery counters and bounded audit survive service restarts.
Critical alerts require acknowledgement; ordinary cards expire. Recently expired
or acknowledged dedupe keys are remembered for 24 hours (bounded to 512). Each source may hold at most 16 visible events and 16 pending deliveries.
Health alerts identify separate fault episodes: repeated checks share one key, but recovery followed by recurrence creates a new key even within the previous acknowledgement window. Recovery does not silently clear an unacknowledged critical alert.
Equal-priority display alerts rotate among sources after acknowledgement; severity always takes precedence. The source turn history survives companion restart.
The event and outbox queues cap at 128. Higher-priority arrivals can replace lower-priority queued records; critical records are retained. Replaced visible records enter dedupe history and their pending messages are cancelled. Successful in-flight sends still count against delivery limits when their alert was acknowledged or replaced before the send completed. Messages expire after 24 hours, retry with
bounded backoff and use stable source sessions; global limit six/hour and two/hour
per source. Quiet hours are 22:00–07:00 in the configured service timezone; urgent
and critical messages bypass quiet hours but not rate limits. Focus suppresses
ordinary display cards. Explicitly requested context (`show_card`, `next`,
`briefing`) remains available during focus and quiet hours. Remote notifications
never echo back to Muse. Focus and break completion use distinct prompts and a
stable timer deadline key to avoid duplicate completion on restart.

The monitor reads existing navigation/widgets/attention on 4174 and core `/health`
on 3000. Existing calendar, academic, GitHub and SwingLab adapters continue running.
Attention records are normalized for the outbox without changing their producers.
The original private-theme screen subscribes to state through a data-only bridge.
Incoming companion alerts reuse its existing alert interface; reactions reuse its
existing heart pulse. The original idle markup, artwork and inline styles are
preserved. Adapter-origin alerts remain rendered by their original connector;
remote acknowledgement first deletes the source alert, retaining it on failure.
Source resolution cancels pending companion messages. Local copies of the same
font families/weights remove external font requests from cold startup.

The display reports its supported presentation capabilities (`reaction`, `alerts`)
through rendered-frame heartbeats. Stored avatar state is not proof that mood,
look direction, sunglasses or other new visual features are presented. Those
features and their controls await Claude Design; backend command responses expose
presentation support. Printing/local-job adapters are also not complete.

Next-action and day briefings use real academic deadline and calendar start
metadata, sorted by timestamp, rather than widget summary counts. Connector data
older than two hours or reporting unhealthy status is labelled unavailable.
The sample Pi unit schedules one local day briefing at 09:00 America/New_York
(`TOTEM_COMPANION_BRIEFING_AT=HH:MM`; empty disables). It may catch up within 90
minutes, deferring while in focus/quiet hours or when both connectors are
unavailable. The per-day marker persists with the event, so service restarts do
not repeat it. Daily briefings expire after 60 seconds and do not proactively
message Muse. Explicit Muse requests are separate from the automatic schedule.

## Local event producers

`events.sock` is separate from Muse's command socket. It accepts one normalized
JSON event per connection and exposes no commands or recovery authority. It is
owner-only, with a named read/write ACL for `TOTEM_COMPANION_EVENT_USER` (the
inspected Pi uses `ashish`). The common Muse group has no access. Grant additional
producer users deliberately; never make this socket world/group writable.

Allowed sources: academic, calendar, github, swinglab, printing, jobs, webhook.
Use stable per-run dedupe keys. Fields are source, type, severity, title, detail,
dedupeKey, optional ISO timestamp, ttlSeconds and proactive. A timestamp must be
within the last 24 hours and no more than a minute ahead. `actions` may only be an
empty array until those controls have a supported contract. Input is bounded to
8 KiB. Unknown fields (including commands, URLs and file paths) are rejected.
Existing queue bounds, priority, quiet hours, expiry and rate limits apply.
Success is returned after state/outbox persistence. Acknowledgement cancels a
pending delivery; stable keys prevent duplicates across restart.

A trusted local job can publish its result without sudo:

```sh
node /srv/pi-hdd/totem-companion-work/totem/deploy/companion/publish-event.mjs <<'JSON'
{"source":"jobs","type":"job.completed","severity":"attention","title":"Local job completed","dedupeKey":"job-name:unique-run-id","ttlSeconds":60}
JSON
```

The client reads one event from stdin, prints its acknowledgement and exits
nonzero on denial/unavailability. It never executes producer content. Printing
and webhook producers can use the same contract; no printer or external HTTP
webhook transport is assumed installed. Actual printer and HTTP webhook transport
integration remain separate acceptance work.

The monitor reads selected oneshot jobs through `systemctl show` only; it does
not start or modify them. `TOTEM_COMPANION_JOB_UNITS` permits up to eight explicit
service names. This Pi watches `academic-ops-sync.service` and
`swinglab-cycle.service`. Persisted per-boot completion cursors avoid replaying
old successful runs or duplicating runs after companion restart. Already failed
jobs are reported once. Failure/recovery uses the shared alert/outbox policy;
routine success is info-only and does not send proactive messages. Running jobs
are not mistaken for completed jobs.

## Install on the inspected Pi

These sample units document the actual checkout paths; adapt them for another host.
Code and venv are HDD-backed. Do not change `/opt/totem/current` or the kiosk URL.
The private-theme bridge is a separate reviewable change preserving original visuals. Create system users `totem-companion` and `musegadget` with
shared group `totem-companion`, shell `/usr/sbin/nologin`, and no additional groups.
Create `/srv/pi-hdd/totem-companion-state` owned by `totem-companion` mode 0700, and
`/var/lib/musegadget` owned by `musegadget` mode 0700.

Upstream SDK pin: `facebookincubator/muse-gadget-sdk` commit
`74a5e2d7fc895f109f83a9a1dbed705dbcd8b1ff`. Keep its clone at
`/srv/pi-hdd/totem-companion-work/muse-gadget-sdk`. Review
[upstream Linux documentation](https://github.com/facebookincubator/muse-gadget-sdk/tree/74a5e2d7fc895f109f83a9a1dbed705dbcd8b1ff/linux).
Use distro Python with `--system-site-packages` for cryptography, D-Bus and GI:

```sh
python3 -m venv --system-site-packages /srv/pi-hdd/totem-companion-work/muse-venv
/srv/pi-hdd/totem-companion-work/muse-venv/bin/pip install --no-cache-dir --require-hashes -r /srv/pi-hdd/totem-companion-work/muse-gadget-sdk/linux/src/musegadget/data/requirements.lock
/srv/pi-hdd/totem-companion-work/muse-venv/bin/pip install --no-cache-dir --no-deps /srv/pi-hdd/totem-companion-work/muse-gadget-sdk/linux
```

Install `recover.sh` as root-owned executable
`/usr/local/libexec/totem-companion-recover`; validate `sudoers.example` with
`visudo -cf` and install mode 0440 to `/etc/sudoers.d/totem-companion`.
Install the units, `systemctl daemon-reload`, then enable/start the two new services.
They wait for HDD code paths and restart independently. `/etc/totem-companion.env`
may configure optional display root/recovery; the samples do not reference a
private theme. The inspected Pi service timezone is `America/New_York`.

## Pair later (requires SDK token and the user's phone)

Pairing is intentionally not started without the user. Store the token in
`/var/lib/musegadget/sdk_token`, owned by `musegadget`, mode 0600, without placing
it in shell arguments, source, issue text or normal Totem data. Use the official
Muse app and SDK token flow. Before pairing, review the upstream BlueZ GATT
`ExchangeMTU=256` requirement; this Pi's Bluetooth config has not been changed yet.

```sh
sudo -u musegadget /srv/pi-hdd/totem-companion-work/muse-venv/bin/python -m musegadget info
sudo -u musegadget /srv/pi-hdd/totem-companion-work/muse-venv/bin/python -m musegadget pair
sudo journalctl -u musegadget -f
```

In Muse app Settings → Devices, enable Developer mode and add the advertised
MuseGadget device. Verify logs say `registered with the Muse`, then run harmless
health/reaction commands from the phone. Never launch upstream `musegadget run`:
it advertises shell/file tools. The installed service launches `muse_bridge.py`.
For unpairing, run the CLI `unpair` as `musegadget` and restart this service.
Identity persists. Neither pairing nor Muse failure restarts core.

## Verification and upgrade

```sh
pnpm test:companion
/srv/pi-hdd/totem-companion-work/muse-venv/bin/python -m unittest discover -s deploy/companion -p '*_test.py'
/srv/pi-hdd/totem-companion-work/muse-venv/bin/python -m pytest -q /srv/pi-hdd/totem-companion-work/muse-gadget-sdk/linux/tests
```

The wrapper uses upstream Service's pinned registry/current-session fields. On SDK
upgrade, review these interfaces, pin the new source and dependencies, rerun tests
and verify pairing/reconnect/phone tools before claiming upgrade compatibility.

## Rollback

The original kiosk and core are unchanged. Disable/stop only `musegadget` and
`totem-companion`, remove their units and the recovery sudoers grant/helper if
uninstalling. Retain state and pairing until explicitly asked to remove them.
There is no core release migration. Core rollback still uses its existing release
symlink. Preserve the original theme checkout for Claude Design implementation.
