#!/usr/bin/env python3
"""Scrub CORS_ORIGIN=* in backend/.env — use MINIAPP_URL origin or empty."""
from pathlib import Path
import re
import sys

p = Path(sys.argv[1] if len(sys.argv) > 1 else 'backend/.env')
t = p.read_text(encoding='utf-8', errors='ignore')
m = re.search(r'^MINIAPP_URL=(.*)$', t, re.M)
origin = ''
if m:
    u = m.group(1).strip().strip('"').strip("'")
    if u.startswith('http'):
        origin = u.rstrip('/')
mm = re.search(r'^CORS_ORIGIN=(.*)$', t, re.M)
old = mm.group(1).strip() if mm else None
if old == '*' or old is None:
    repl = f'CORS_ORIGIN={origin}' if origin else 'CORS_ORIGIN='
    if mm:
        t2 = re.sub(r'^CORS_ORIGIN=.*$', repl, t, count=1, flags=re.M)
    else:
        t2 = t.rstrip() + '\n' + repl + '\n'
    p.write_text(t2, encoding='utf-8')
    print('cors_scrubbed', {'was': old, 'now': origin or '(empty)'})
else:
    print('cors_ok', (old or '')[:80])
