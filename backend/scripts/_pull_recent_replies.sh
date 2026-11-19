#!/bin/bash
# Extract recent bot replies from pm2 out log
LOG=/root/.pm2/logs/tgbot-out.log
python3 - <<'PY'
import re, pathlib
log = pathlib.Path("/root/.pm2/logs/tgbot-out.log")
if not log.exists():
    print("[]")
    raise SystemExit
data = log.read_bytes()[-800000:].decode("utf-8", "replace")
pairs = []
# "Ответ для Name: \"text\""
for m in re.finditer(r'Ответ для [^:]+: "([^"\n]{2,200})"', data):
    pairs.append({"user": "...", "bot": m.group(1)})
# also bare without escape issues
for m in re.finditer(r'Ответ для [^\n]{1,40}: "([^"]{2,180})"', data):
    t = m.group(1)
    if not any(p["bot"] == t for p in pairs):
        pairs.append({"user": "...", "bot": t})
# dedupe keep last 40
seen = set()
out = []
for p in reversed(pairs):
    k = p["bot"].strip().lower()
    if k in seen or len(k) < 2:
        continue
    seen.add(k)
    out.append(p)
    if len(out) >= 36:
        break
out.reverse()
import json
print(json.dumps(out, ensure_ascii=False, indent=2))
PY
