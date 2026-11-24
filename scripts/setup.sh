#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f .env ]; then
  python3 - <<'PY'
from pathlib import Path
import secrets
s=Path('.env.example').read_text().replace('replace-with-random-password',secrets.token_hex(18)).replace('replace-with-random-token',secrets.token_hex(24))
Path('.env').write_text(s)
Path('.env').chmod(0o600)
PY
fi
printf 'Local .env is ready. Keep credentials private.\n'
