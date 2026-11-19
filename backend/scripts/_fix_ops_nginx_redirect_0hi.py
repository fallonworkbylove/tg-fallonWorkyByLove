#!/usr/bin/env python3
"""Restore main-site /ops/ static serving (undo broken ops-loverussian redirect)."""
from pathlib import Path
import re
import subprocess
import sys

cfg = Path('/etc/nginx/sites-available/tgbot')
text = cfg.read_text(encoding='utf-8', errors='ignore')
new_block = """    location = /ops {
        return 301 /ops/;
    }
    location /ops/ {
        alias /root/opt/tgbot/tg-miniapp-loverussian/ops-console/app/;
        add_header Cache-Control "no-cache";
        try_files $uri $uri/ =404;
    }"""
text2, n = re.subn(
    r'location = /ops\s*\{.*?\}\s*location /ops/\s*\{.*?\}',
    new_block.strip(),
    text,
    count=1,
    flags=re.S,
)
if not n:
    print('FAIL: ops location block not found', file=sys.stderr)
    sys.exit(1)
cfg.write_text(text2, encoding='utf-8')
print('REVERTED_OPS_OK', n)
subprocess.check_call(['nginx', '-t'])
subprocess.check_call(['systemctl', 'reload', 'nginx'])
print('NGINX_RELOADED')
