#!/bin/bash
# Extract last ~1.2MB of tgbot-out into JSON replies for audit
python3 - <<'PY'
import re, json, pathlib
log = pathlib.Path("/root/.pm2/logs/tgbot-out.log")
data = log.read_bytes()[-1200000:].decode("utf-8", "replace") if log.exists() else ""
# bot replies
bots = []
for m in re.finditer(r'\[([^\]]+)\] Ответ для ([^:]+): "([^"\\]*(?:\\.[^"\\]*)*)"', data):
    bots.append({"account": m.group(1)[:40], "peer": m.group(2)[:40], "bot": m.group(3).replace('\\n','\n').replace('\\"','"')[:220]})
# also simpler form without account brackets nesting
for m in re.finditer(r'Ответ для ([^:]+): "([^"\n]{2,220})"', data):
    t = m.group(2)
    if not any(b["bot"] == t for b in bots):
        bots.append({"account": "", "peer": m.group(1)[:40], "bot": t})
# dedupe last 80
seen=set(); out=[]
for b in reversed(bots):
    k=b["bot"].strip().lower()
    if len(k)<2 or k in seen: continue
    seen.add(k); out.append(b)
    if len(out)>=80: break
out.reverse()
print(json.dumps(out, ensure_ascii=False, indent=2))
PY
