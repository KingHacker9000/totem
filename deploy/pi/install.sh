#!/usr/bin/env bash
set -euo pipefail

PREFIX=${TOTEM_PREFIX:-/opt/totem}
STATE_DIR=${TOTEM_STATE_DIR:-/var/lib/totem}
CONFIG_DIR=${TOTEM_CONFIG_DIR:-/etc/totem}
SERVICE_USER=${TOTEM_SERVICE_USER:-totem}
SOURCE_DIR=${TOTEM_SOURCE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}
RELEASE_RETENTION=${TOTEM_RELEASE_RETENTION:-2}
MIN_FREE_MIB=${TOTEM_MIN_FREE_MIB:-2048}
RELEASE_POLICY="$SOURCE_DIR/deploy/pi/release-policy.mjs"

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
require_command tar

if ! node -e '
const [major, minor, patch] = process.versions.node.split(".").map(Number);
const ok = major > 22 || (major === 22 && (minor > 20 || (minor === 20 && patch >= 0)));
process.exit(ok ? 0 : 1);
'; then
  echo "Totem requires Node >=22.20.0; found $(node --version)." >&2
  exit 1
fi

if [[ ! -f "$RELEASE_POLICY" ]]; then
  echo "Release policy tool not found: $RELEASE_POLICY" >&2
  exit 1
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home "$STATE_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0750 "$STATE_DIR"
install -d -o root -g "$SERVICE_USER" -m 0750 "$CONFIG_DIR"
install -d -o root -g root -m 0755 "$PREFIX/releases"

node "$RELEASE_POLICY" prune --prefix "$PREFIX" --retain "$RELEASE_RETENTION"
node "$RELEASE_POLICY" preflight \
  --prefix "$PREFIX" \
  --source "$SOURCE_DIR" \
  --min-free-mib "$MIN_FREE_MIB"

release="$PREFIX/releases/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -o root -g root -m 0755 "$release"
install_complete=0
cleanup_failed_release() {
  if [[ $install_complete -eq 0 && -d "$release" ]]; then
    echo "Install failed; removing incomplete release $release" >&2
    rm -rf --one-file-system "$release"
  fi
}
trap cleanup_failed_release EXIT

tar \
  --exclude=.git \
  --exclude=node_modules \
  --exclude='*/node_modules' \
  --exclude=dist \
  --exclude='*/dist' \
  -C "$SOURCE_DIR" -cf - . | tar --no-same-owner -C "$release" -xf -

chown -R root:root "$release"
chmod -R a+rX "$release"

cd "$release"
pnpm install --frozen-lockfile
pnpm build

ln -sfn "$release" "$PREFIX/current"
install_complete=1
trap - EXIT

if [[ ! -f "$CONFIG_DIR/totem.env" ]]; then
  install -o root -g "$SERVICE_USER" -m 0640 deploy/pi/totem.env.example "$CONFIG_DIR/totem.env"
fi

install -o root -g root -m 0644 deploy/pi/totem.service /etc/systemd/system/totem.service
systemctl daemon-reload
systemctl enable totem.service
systemctl restart totem.service

# The service may be active before the HTTP listener is ready. Wait for the
# bounded readiness contract rather than making operators race the first probe.
node "$release/deploy/pi/lifecycle-check.mjs" --ready-only

node "$RELEASE_POLICY" prune --prefix "$PREFIX" --retain "$RELEASE_RETENTION"
node "$RELEASE_POLICY" report --prefix "$PREFIX"

echo "Totem installed at $release"
echo "Current release: $(readlink -f "$PREFIX/current")"
echo "State directory prepared by installer: $STATE_DIR"
echo "Configuration: $CONFIG_DIR/totem.env"
echo "Release retention: $RELEASE_RETENTION (minimum 2)"
echo "Post-install free-space reserve: ${MIN_FREE_MIB} MiB"
echo "Status: systemctl status totem --no-pager"
echo "Lifecycle validation: sudo node $PREFIX/current/deploy/pi/lifecycle-check.mjs --restart"
