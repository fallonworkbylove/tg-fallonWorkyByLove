#!/bin/bash
# Day summary for tgbot logs (UTC+3 wall via date; logs often UTC)
set -euo pipefail
OUT=/tmp/audit_logs_today.txt
: > "$OUT"
{
  echo "=== HOST $(date -u) / local $(TZ=Europe/Moscow date) ==="
  uptime
  pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];e=p["pm2_env"];print({"status":e.get("status"),"restarts":e.get("restart_time"),"unstable":e.get("unstable_restarts"),"PROXY":len([x for x in (e.get("PROXY_LIST")or"").split(";")if x.strip()]),"created":e.get("created_at")})'

  echo
  echo "=== LOG SIZES ==="
  ls -lh /root/.pm2/logs/tgbot-*.log

  # Today MSK = 2026-11-03; also match Nov 3 UTC stamps in gramjs
  DAY_MSK="2026-11-03"
  DAY_UTC="2026-11-03"

  echo
  echo "=== RESTARTS / BOOT (out) ==="
  grep -aE "Server is running|injected env|Warm TG|PROXY_LIST|Work \(DC\)|Login \(residential\)" /root/.pm2/logs/tgbot-out.log | tail -80

  echo
  echo "=== ERR TOP PATTERNS (counts) ==="
  python3 - <<'PY'
from collections import Counter
import re
path="/root/.pm2/logs/tgbot-error.log"
# read last ~8MB to cover a day-ish
with open(path,"rb") as f:
    f.seek(0,2); n=f.tell(); f.seek(max(0,n-8_000_000))
    data=f.read().decode("utf-8","replace")
lines=data.splitlines()
# keep lines that look like today (ISO or Nov 3) OR if no date, still count recent chunk
today=[l for l in lines if "2026-11-03" in l or "Nov  3" in l or "Nov 3" in l]
use=today if len(today)>50 else lines[-5000:]
print("lines_used", len(use), "(today_tagged", len(today), ")")
keys=Counter()
for l in use:
    if "SocksClientError" in l or "invalid Socks5" in l or "Proxy connection timed out" in l:
        keys["socks_proxy_error"]+=1
    elif "helpRequestNotifier" in l and "long polling" in l:
        keys["notifier_long_poll"]+=1
    elif "helpRequestNotifier" in l and "fetch failed" in l:
        keys["notifier_fetch_failed"]+=1
    elif "helpRequestNotifier" in l:
        keys["notifier_other"]+=1
    elif "SESSION_WATCH" in l:
        keys["session_watch"]+=1
    elif "REFUSE_PROXY" in l:
        keys["refuse_proxy"]+=1
    elif "OpenAI" in l or "openai" in l:
        keys["openai"]+=1
    elif "ECONNREFUSED" in l or "Network is unreachable" in l:
        keys["net_unreachable"]+=1
    elif "ERROR" in l or "Error" in l:
        keys["other_error"]+=1
print("counts:")
for k,v in keys.most_common(20):
    print(f"  {k}: {v}")
# session watch samples
sw=[l for l in use if "SESSION_WATCH" in l]
print("SESSION_WATCH samples", len(sw))
for l in sw[-8:]:
    print(" ", l[-160:])
# notifier first/last
np=[l for l in use if "long polling" in l]
if np:
    print("long_poll first:", np[0][-140:])
    print("long_poll last:", np[-1][-140:])
PY

  echo
  echo "=== OUT ACTIVITY TODAY-ISH ==="
  python3 - <<'PY'
from collections import Counter
import re
path="/root/.pm2/logs/tgbot-out.log"
with open(path,"rb") as f:
    f.seek(0,2); n=f.tell(); f.seek(max(0,n-12_000_000))
    data=f.read().decode("utf-8","replace")
lines=data.splitlines()
# Prefer lines with today's date stamp; gramjs uses 2026-11-03T...
today=[l for l in lines if "2026-11-03" in l]
chunk=today if today else lines[-8000:]
print("out_lines_used", len(chunk), "today_tagged", len(today))
replies=[l for l in chunk if "Ответ для" in l]
models=[l for l in chunk if "Запрос к модели" in l]
silence=[l for l in chunk if "silence" in l.lower() or "тишин" in l.lower() or "heal" in l.lower()]
warm=[l for l in chunk if "Warm TG" in l]
boots=[l for l in chunk if "Server is running" in l]
print("replies", len(replies))
print("model_calls", len(models))
print("silence/heal mentions", len(silence))
print("Warm TG lines", len(warm))
print("boots", len(boots))
# per account reply counts
acc=Counter()
for l in replies:
    m=re.search(r"\[(\d+)\s+[—\-]", l)
    if m: acc[m.group(1)]+=1
print("top accounts by replies:")
for a,c in acc.most_common(12):
    print(f"  {a}: {c}")
print("last Warm:")
for l in warm[-5:]:
    print(" ", l[-180:])
print("last replies:")
for l in replies[-6:]:
    print(" ", l[-160:])
PY

  echo
  echo "=== CONNECTIVITY NOW ==="
  curl -sS -o /dev/null -w "api.telegram.org %{http_code} t=%{time_total}\n" --connect-timeout 8 https://api.telegram.org/ || echo "api.telegram.org FAIL"
  curl -sS -o /dev/null -w "google %{http_code}\n" --connect-timeout 5 https://www.google.com/ || echo google_FAIL

} | tee "$OUT"
echo "WROTE $OUT"
