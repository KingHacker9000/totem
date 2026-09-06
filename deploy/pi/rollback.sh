#!/usr/bin/env bash
set -euo pipefail

PREFIX=${TOTEM_PREFIX:-/opt/totem}
CURRENT="$PREFIX/current"

if [[ ${EUID} -ne 0 ]]; then
  echo "rollback.sh must run as root (use sudo)." >&2
  exit 1
fi

mapfile -t releases < <(find "$PREFIX/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' 2>/dev/null | sort -nr | awk '{print $2}')

if (( ${#releases[@]} < 2 )); then
  echo "No previous Totem release is available to roll back to." >&2
  exit 1
fi

current=$(readlink -f "$CURRENT" || true)
target=""
for release in "${releases[@]}"; do
  if [[ "$release" != "$current" ]]; then
    target="$release"
    break
  fi
done

if [[ -z "$target" ]]; then
  echo "Could not determine a previous release." >&2
  exit 1
fi

ln -sfn "$target" "$CURRENT"
systemctl restart totem.service

echo "Rolled back Totem to $target"
systemctl --no-pager --full status totem.service || true
