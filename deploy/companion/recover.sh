#!/bin/sh
# Fixed local recovery targets only. Invoked through an exact sudoers allowlist.
set -eu
[ "$#" -eq 1 ] || exit 64
case "$1" in
  totem-portal-kiosk.service|totem.service)
    exec /usr/bin/systemctl restart "$1" ;;
  brightness:*)
    value=${1#brightness:}
    case "$value" in ''|*[!0-9]*) exit 64;; esac
    [ "$value" -ge 1 ] && [ "$value" -le 100 ] || exit 64
    path=/sys/class/backlight/11-0045
    [ -r "$path/max_brightness" ] || exit 69
    max=$(cat "$path/max_brightness")
    printf '%s\n' "$((max * value / 100))" > "$path/brightness" ;;
  *) exit 64 ;;
esac
