#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
curl -sS http://127.0.0.1:3000/api/health; echo
pm2 jlist > /tmp/pm2j_audit.json
python3 - <<'PY'
import json, pathlib, re, sys
j=json.load(open('/tmp/pm2j_audit.json'))
e=[x for x in j if x['name']=='tgbot'][0]['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print('pm2', {'status':e['status'],'PROXY':n})
assert e['status']=='online' and n>=5

base = pathlib.Path('/root/opt/tgbot/tg-miniapp-loverussian')
auth = (base/'backend/middleware/telegramAuth.js').read_text(encoding='utf-8', errors='ignore')
server = (base/'backend/server.js').read_text(encoding='utf-8', errors='ignore')
guid = (base/'backend/lib/getUserId.js').read_text(encoding='utf-8', errors='ignore')
accounts = (base/'backend/routes/accounts.js').read_text(encoding='utf-8', errors='ignore')
app = (base/'frontend/app.js').read_text(encoding='utf-8', errors='ignore')
ops = (base/'backend/services/opsActivityLog.js').read_text(encoding='utf-8', errors='ignore')
hh = (base/'backend/services/humanHardening.js').read_text(encoding='utf-8', errors='ignore')
oq = (base/'backend/services/opsQuality.js').read_text(encoding='utf-8', errors='ignore')
oh = (base/'backend/services/howLong.js').read_text(encoding='utf-8', errors='ignore')
obj = (base/'backend/services/objectionHandler.js').read_text(encoding='utf-8', errors='ignore')
idx = (base/'frontend/index.html').read_text(encoding='utf-8', errors='ignore')
p0=0
def chk(name, ok):
    global p0
    print(('OK' if ok else 'P0'), name)
    if not ok: p0 += 1
chk('cors_not_star', 'origin: true' not in server and "origin: '*'" not in server)
chk('getUserId_no_fallback_1', not re.search(r'\breturn\s+1\b', guid))
chk('getUserId_401', '401' in guid)
chk('auth_bypass_gated', 'X-Auth-Bypass-Key' in auth)
chk('accounts_activity_route', "router.get('/activity'" in accounts)
chk('activity_accountIds', 'accountIds' in ops)
chk('worker_feed_ui', 'worker-activity-list' in idx and 'getWorkerActivity' in app)
chk('escapeHtml', 'function escapeHtml' in app)
chk('phraseBan_wiring', 'phraseBanLimitFor' in hh)
chk('howlong_21', 'HOWLONG_ARCHIVE_DAYS' in oh and '21' in oh)
chk('flip_guard', re.search(r'это\s*я|не я|flip', obj, re.I) is not None)
chk('opsQuality_schedulers', 'startOpsQualitySchedulers' in oq)
print('GATES_P0', p0)
sys.exit(1 if p0 else 0)
PY
echo "--- live ---"
grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал|outbound ' /root/.pm2/logs/tgbot-out*.log 2>/dev/null | tail -15 || true
echo "--- err ---"
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|REFUSE_PROXY|voice is not defined' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -15 || true
echo QUICK_GATES_OK
