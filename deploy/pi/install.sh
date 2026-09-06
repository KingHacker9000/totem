#!/usr/bin/env bash
set -euo pipefail

PREFIX=${TOTEM_PREFIX:-/opt/totem}
STATE_DIR=${TOTEM_STATE_DIR:-/var/lib/totem}
CONFIG_DIR=${TOTEM_CONFIG_DIR:-/etc/totem}
SERVICE_USER=${TOTEM_SERVICE_USER:-totem}
SOURCE_DIR=${TOTEM_SOURCE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}

require_root() {
  if [[ ${EUID} -ne 0 ]]; then
    echo "install.sh must run as root (use sudo)." >&2
    exit 1
  fi
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command not found: $1" >&2
    exit 1
  }
}

require_root
require_command systemctl
require_command node
require_command pnpm

node_major=$(node -p 'process.versions.node.split(".")[0]')
if (( node_major < 22 )); then
  echo "Totem requires Node >=22.20.0; found $(node --version)." >&2
  exit 1
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home "$STATE_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0750 "$STATE_DIR"
install -d -o root -g "$SERVICE_USER" -m 0750 "$CONFIG_DIR"
install -d -o root -g root -m 0755 "$PREFIX"

release="$PREFIX/releases/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -o root -g root -m 0755 "$release"
cp -a "$SOURCE_DIR/." "$release/"

cd "$release"
pnpm install --frozen-lockfile
pnpm build

ln -sfn "$release" "$PREFIX/current"

if [[ ! -f "$CONFIG_DIR/totem.env" ]]; then
  install -o root -g "$SERVICE_USER" -m 0640 deploy/pi/totem.env.example "$CONFIG_DIR/totem.env"
fi

install -o root -g root -m 0644 deploy/pi/totem.service /etc/systemd/system/totem.service
systemctl daemon-reload
systemctl enable totem.service
systemctl restart totem.service

echo "Totem installed at $release"
echo "Current release: $(readlink -f "$PREFIX/current")"
echo "State directory: $STATE_DIR"
echo "Configuration: $CONFIG_DIR/totem.env"
echo "Status: systemctl status totem --no-pager"
