#!/bin/sh
# Install only the integration lifecycle. Existing credentials/state stay in place.
set -eu
[ "$(id -u)" -eq 0 ] || { echo 'Run with sudo' >&2; exit 77; }
base=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
for unit in totem.service totem-companion.service musegadget.service; do
  install -d -m 755 "/etc/systemd/system/$unit.d"
  for file in "$base/systemd/$unit.d/"*.conf; do
    install -o root -g root -m 644 "$file" "/etc/systemd/system/$unit.d/$(basename "$file")"
  done
done
python3 - <<'PY'
from pathlib import Path
import re, shutil
p=Path('/etc/totem-companion.env')
s=p.read_text() if p.exists() else ''
if p.exists() and not Path(str(p)+'.pre-integrated').exists():
    shutil.copy2(p,str(p)+'.pre-integrated')
s=re.sub(r'^TOTEM_COMPANION_APPROVALS=.*\n?', '', s, flags=re.M)
p.write_text(s.rstrip()+'\nTOTEM_COMPANION_APPROVALS=1\n')
PY
systemctl daemon-reload
systemctl restart totem-companion.service musegadget.service totem-admin.service totem-portal-kiosk.service
