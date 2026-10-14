#!/bin/sh
# Fixed local recovery targets only. Invoked through an exact sudoers allowlist.
set -eu
[ "$#" -eq 1 ] || exit 64
case "$1" in
  totem-portal-kiosk.service|totem.service)
    exec /usr/bin/systemctl restart "$1" ;;
  screen:off)
    path=/sys/class/backlight/11-0045
    [ -r "$path/brightness" ] || exit 69
    value=$(cat "$path/brightness")
    if [ "$value" -gt 0 ]; then
      umask 077
      printf '%s\n' "$value" > /run/totem-screen-brightness
    fi
    printf '0\n' > "$path/brightness" ;;
  screen:on)
    path=/sys/class/backlight/11-0045
    [ -r "$path/max_brightness" ] || exit 69
    [ "$(cat "$path/brightness")" -eq 0 ] || exit 0
    max=$(cat "$path/max_brightness")
    value=$max
    if [ -r /run/totem-screen-brightness ]; then
      value=$(cat /run/totem-screen-brightness)
    fi
    case "$value" in ''|*[!0-9]*) exit 64;; esac
    [ "$value" -ge 1 ] && [ "$value" -le "$max" ] || exit 64
    printf '%s\n' "$value" > "$path/brightness" ;;
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
