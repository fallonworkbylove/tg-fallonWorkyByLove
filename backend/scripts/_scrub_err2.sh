#!/bin/bash
python3 <<'PY'
from pathlib import Path
needle = 'sk-' + 'test'  # avoid self-match in this file when grepping repo? fine
p = Path('/root/.pm2/logs/tgbot-error.log')
lines = [ln for ln in p.read_text(encoding='utf-8', errors='ignore').splitlines() if needle not in ln]
lines.append('[KEYPURGE] error log cleaned')
p.write_text('\n'.join(lines) + '\n', encoding='utf-8')
left = sum(1 for ln in lines if needle in ln)
print('left', left)
PY
grep -c sk-test /root/.pm2/logs/tgbot-error.log || echo 0
echo ERR_CLEAN
