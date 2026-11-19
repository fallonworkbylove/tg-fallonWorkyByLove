#!/bin/bash
set -euo pipefail
ERR=/root/.pm2/logs/tgbot-error.log
python3 <<'PY'
from pathlib import Path
p = Path('/root/.pm2/logs/tgbot-error.log')
t = p.read_text(encoding='utf-8', errors='ignore')
lines = [ln for ln in t.splitlines() if 'sk-test' not in ln]
lines.append('[KEYPURGE] no sk-test lines left')
p.write_text('\n'.join(lines) + '\n', encoding='utf-8')
print('remaining_sk_test', sum(1 for ln in lines if 'sk-test' in ln))
PY
# kill hung finish if any
pkill -f '_finish_key_purge|_purge_sk_test' 2>/dev/null || true
echo SCRUB_OK
