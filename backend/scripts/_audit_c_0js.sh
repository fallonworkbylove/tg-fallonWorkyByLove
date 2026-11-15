#!/bin/bash
# Хард жёсткий C-аудит 0js: full + ultra + live + auth/proxy
set -uo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE/backend"
echo "=== AUDIT C 0js ==="

eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['OPENAI_API_KEY','PROXY_LIST','OPENAI_PROXY_LIST','DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','MYSQL_HOST','MYSQL_USER','MYSQL_PASSWORD','MYSQL_DATABASE']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"

n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo "PROXY_LEN=$n"
[ "$n" -ge 5 ] || echo "P0 REFUSE_PROXY_LOW"

echo
echo "========== FULL HARD 0ht =========="
sed -i 's/\r$//' scripts/_hard_audit_full_0ht.js 2>/dev/null || true
timeout 300 node scripts/_hard_audit_full_0ht.js 2>&1 | tee /tmp/audit_full_0js.txt
FULL_RC=${PIPESTATUS[0]}
echo "FULL_RC=$FULL_RC"

echo
echo "========== ULTRA HARD =========="
sed -i 's/\r$//' scripts/_ultra_hard_audit.js 2>/dev/null || true
timeout 180 node scripts/_ultra_hard_audit.js 2>&1 | tee /tmp/audit_ultra_0js.txt
ULTRA_RC=${PIPESTATUS[0]}
echo "ULTRA_RC=$ULTRA_RC"

echo
echo "========== RECENT SMOKES 0jp/0jq/0jr =========="
for s in _smoke_voice_promise_0jp.js _smoke_daily_day2_only_0jq.js _smoke_reply_screens_0jr.js _smoke_vk_intro_0jo.js; do
  if [ -f "scripts/$s" ]; then
    sed -i 's/\r$//' "scripts/$s" || true
    timeout 45 node "scripts/$s" 2>&1 | tail -5 || echo "FAIL $s"
  else
    echo "MISSING $s"
  fi
done

echo
echo "========== STATIC GATES =========="
python3 - <<'PY'
import re, pathlib
B=pathlib.Path('.')
def r(p):
  try: return (B/p).read_text(encoding='utf-8',errors='ignore')
  except: return ''
auth=r('middleware/telegramAuth.js')
guid=r('lib/getUserId.js')
srv=r('server.js')
daily=r('services/dailyPhotos.js')
thin=r('services/humanThinLayer.js')
ai=r('services/aiResponder.js')
voice=r('services/voiceReplies.js')
how=r('services/howLong.js') or r('services/howlong.js')
# find howlong file
import glob
hl_files=glob.glob('services/*[Hh]ow*[Ll]ong*.js')+glob.glob('services/lead*.js')
print('howlong_candidates', hl_files)
fails=[]
def chk(name, cond, sev='P0'):
  print(('OK' if cond else sev), name)
  if not cond: fails.append((sev,name))
chk('cors_not_star', not re.search(r'origin:\s*[\'"]?\*', srv) and 'origin: true' not in srv.replace(' ',''))
chk('getUserId_no_return_1', not re.search(r'\breturn\s+1\b', guid) and 'fallback = 1' not in guid)
chk('getUserId_401', '401' in guid)
chk('auth_bypass_force', 'TELEGRAM_AUTH_BYPASS_FORCE' in auth)
chk('auth_timingSafe', 'timingSafeEqual' in auth)
chk('daily_day2_only', 'DAY2_AGE_MAX_H' in daily and 'past_day2_nft_phase' in daily)
chk('daily_no_day3_window', 'moscowWindowBounds(now, 13, 15)' not in daily)
chk('geo_coffee_guard', 'USER_ASKED_GEO_RE' in ai and 'ACTIVITY_FILLER_RE' in thin)
chk('mood_no_raskroy_clear', 'как\\s+настроен' in thin or 'как\\s+настроен' in thin.replace('\\\\','\\'))
chk('voice_soft_promise', 'softVoiceAskWithoutFile' in voice)
chk('opsQuality_boot', 'opsQuality' in srv or 'startOpsQuality' in srv or 'silenceWatch' in srv)
print('STATIC_FAILS', len(fails), fails)
PY

echo
echo "========== LIVE LOGS =========="
grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал|Дайджест отсева|outbound |past_day2|REFUSE_PROXY' /root/.pm2/logs/tgbot-out*.log 2>/dev/null | tail -40 || true
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|OPENAI|REFUSE_PROXY|TypeError|ReferenceError|is not defined' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -25 || true

echo
echo "========== PM2 =========="
pm2 jlist | python3 -c 'import json,sys; j=json.load(sys.stdin); p=[x for x in j if x["name"]=="tgbot"][0]; e=p["pm2_env"]; pl=e.get("PROXY_LIST")or""; print({"status":e["status"],"pm2_PROXY_LEN":len([x for x in pl.split(";") if x.strip()]),"restarts":e.get("restart_time")})'

echo
echo "AUDIT_C_0JS_DONE full=$FULL_RC ultra=$ULTRA_RC"
exit 0
