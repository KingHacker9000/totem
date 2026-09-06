#!/usr/bin/env bash
set -euo pipefail

STATE_DIR=${TOTEM_STATE_DIR:-/var/lib/totem}
PORT=${TOTEM_PORT:-3000}

echo "== Totem Pi diagnostics =="
echo "time: $(date --iso-8601=seconds)"
echo "kernel: $(uname -srmo)"
echo "node: $(node --version 2>/dev/null || echo unavailable)"
echo "pnpm: $(pnpm --version 2>/dev/null || echo unavailable)"
echo "state_dir: $STATE_DIR"
echo

echo "== service =="
systemctl --no-pager --full status totem.service || true
echo

echo "== health =="
if command -v curl >/dev/null 2>&1; then
  curl --fail --silent --show-error --max-time 3 "http://127.0.0.1:${PORT}/health" || true
  echo
else
  echo "curl unavailable"
fi

echo "== storage =="
df -h "$STATE_DIR" 2>/dev/null || df -h /
echo

echo "== memory =="
free -h 2>/dev/null || true
echo

echo "== temperature/throttling =="
if command -v vcgencmd >/dev/null 2>&1; then
  vcgencmd measure_temp || true
  vcgencmd get_throttled || true
elif [[ -r /sys/class/thermal/thermal_zone0/temp ]]; then
  awk '{printf "cpu_temp=%.1fC\n", $1/1000}' /sys/class/thermal/thermal_zone0/temp
else
  echo "temperature telemetry unavailable"
fi

echo

echo "== recent logs =="
journalctl -u totem.service -n 80 --no-pager || true
