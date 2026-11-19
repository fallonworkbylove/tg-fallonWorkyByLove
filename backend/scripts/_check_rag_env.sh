#!/bin/bash
echo "=== .env ==="
grep -E 'RAG_|OPENAI_MODEL' /root/opt/tgbot/tg-miniapp-loverussian/backend/.env 2>/dev/null || echo "(no matches in .env)"
echo "=== pm2 dump ==="
python3 <<'PY'
import json
try:
    d=json.load(open("/root/.pm2/dump.pm2"))
except Exception as e:
    print("dump fail", e); raise SystemExit
apps=[x for x in d if x.get("name")=="tgbot"]
if not apps:
    print("tgbot not in dump"); raise SystemExit
e=apps[0].get("env") or {}
keys=sorted(k for k in e if "RAG" in k or k.startswith("OPENAI_MODEL"))
if not keys:
    print("(no RAG_/OPENAI_MODEL in pm2 env)")
for k in keys:
    print(f"{k}={e.get(k)!r}")
# default from code
rag=e.get("RAG_ENABLED")
print("---")
print("effective RAG_ENABLED:", rag if rag is not None else "(unset → ON by default in ragExamples.js)")
PY
echo "=== recent rag logs ==="
pm2 logs tgbot --lines 200 --nostream 2>/dev/null | grep -iE 'ragExamples|RAG_' | tail -n 15 || echo "(no rag log lines)"
