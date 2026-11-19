import json, re
from pathlib import Path
t = Path('/tmp/ultra.txt').read_text(encoding='utf-8', errors='ignore')
# strip header
i = t.find('{')
if i < 0:
    print('no json')
    raise SystemExit(1)
# find first big json after === ULTRA
jstart = t.find('{\n  "fix_since"')
if jstart < 0:
    jstart = t.find('{"fix_since"')
chunk = t[jstart:]
# naive brace match
depth = 0
end = None
for idx, ch in enumerate(chunk):
    if ch == '{':
        depth += 1
    elif ch == '}':
        depth -= 1
        if depth == 0:
            end = idx + 1
            break
obj = json.loads(chunk[:end])
print('SCORE', json.dumps(obj.get('score'), ensure_ascii=False))
print('OVERALL', obj.get('overall'))
print('CHECKS', obj.get('checks'))
print('P0_COUNT', sum(1 for f in obj.get('findings') or [] if f.get('sev') == 'P0'))
print('FINDINGS:')
for f in obj.get('findings') or []:
    print(f"  [{f.get('sev')}] {f.get('cat')}: {f.get('name')} {f.get('detail') or ''}")
