#!/bin/bash
python3 <<'PY'
import json
t=open('/tmp/aud_s5_1.txt').read()
i=t.index('{'); j=t.rindex('}')
d=json.loads(t[i:j+1])
print('FINDINGS:')
print(json.dumps(d.get('findings'), ensure_ascii=False, indent=2))
print('FAILED CHECKS:')
for c in d.get('results') or d.get('checks_detail') or []:
    if c.get('ok') is False or c.get('pass') is False:
        print(json.dumps(c, ensure_ascii=False)[:500])
# also dump keys
print('KEYS', list(d.keys()))
if 'checks' in d and isinstance(d['checks'], dict):
    print('checks', d['checks'])
PY
