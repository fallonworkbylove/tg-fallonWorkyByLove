#!/bin/bash
# Hard жёсткий (C) audit for 0ih + scores
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian/backend
cd "$BASE"
export OPENAI_API_KEY="${OPENAI_API_KEY:-sk-audit}"
export AUDIT_FIX_SINCE="${AUDIT_FIX_SINCE:-2026-11-04 17:00:00}"

echo "=== C AUDIT 0ih $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

echo "--- pm2/proxy ---"
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
pl=e.get('PROXY_LIST')or''
print({'status':e['status'],'PROXY':len([x for x in pl.split(';') if x.strip()]),'restarts':e.get('restart_time')})
PY

echo "--- hard_0ih ---"
node scripts/_hard_audit_0ih.js || echo HARD_0IH_FAIL=$?

echo "--- smoke_regress ---"
node scripts/_smoke_regress.js || echo SMOKE_REGRESS_FAIL=$?

echo "--- hard_full_0ht (legacy smokes may soft-fail) ---"
set +e
node scripts/_hard_audit_full_0ht.js > /tmp/full_0ht.txt 2>&1
FULL_EC=$?
set -e
tail -n 40 /tmp/full_0ht.txt
echo FULL_EC=$FULL_EC

echo "--- ultra_hard ---"
set +e
node scripts/_ultra_hard_audit.js > /tmp/ultra.txt 2>&1
ULTRA_EC=$?
set -e
tail -n 50 /tmp/ultra.txt
echo ULTRA_EC=$ULTRA_EC

echo "--- score_10of10 ---"
set +e
node scripts/_audit_10of10_score.js > /tmp/score10.txt 2>&1
SCORE_EC=$?
set -e
cat /tmp/score10.txt
echo SCORE_EC=$SCORE_EC

echo "--- live logs ---"
grep -aE 'ответил, сколько на дв|отсев \+ архив|AI silence|outbound |skip reason=' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -25 || true
echo "--- err ---"
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|OPENAI|REFUSE_PROXY|fetch failed' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -15 || true

echo "--- human checklist static ---"
python3 - <<'PY'
from pathlib import Path
s=Path('services')
checks=[]
def has(rel, pat):
    t=Path(rel).read_text(encoding='utf-8',errors='ignore')
    import re
    return bool(re.search(pat,t,re.I))
checks.append(('howlong_21', has('services/howLong.js', r'HOWLONG_ARCHIVE_DAYS\s*=\s*21')))
checks.append(('filter_gate', has('services/leadScoring.js', r'давно\\s\+на\\s\+дв') and has('services/leadScoring.js', r'молчит')))
checks.append(('no_trash_wire', not has('services/replyPipeline.js', r'trashPeerFilter')))
checks.append(('ideas14', has('services/humanHardening.js', r'humanIdeas14')))
checks.append(('kaif', has('services/softHumanLite.js', r'breakKaifEcho')))
checks.append(('flip_guard', has('services/humanHardening.js', r'это\s*я|beard|чуж')))
checks.append(('phrase_ban', has('services/humanHardening.js', r'phraseBanLimitFor')) )
checks.append(('ops_sched', has('services/opsQuality.js', r'startOpsQualitySchedulers')) )
checks.append(('bot_direct', not has('services/helpRequestNotifier.js', r'firstSocks5FromEnv')) )
ok=sum(1 for _,v in checks if v)
print({'human_checks_ok':ok,'human_checks_total':len(checks),'detail':checks})
# score 0-10 from checks
print('HUMAN_STATIC_SCORE', round(10*ok/len(checks),1))
PY

echo "--- composite ---"
python3 - <<'PY'
import json,re,pathlib
# parse ultra scores if present
ultra=pathlib.Path('/tmp/ultra.txt').read_text(encoding='utf-8',errors='ignore')
cats={}
for m in re.finditer(r'"?(security|reliability|ai|ui|ops)"?\s*[:=]\s*([0-9.]+)', ultra):
    cats[m.group(1)]=float(m.group(2))
# also look for score lines like security: 9.5
for m in re.finditer(r'(security|reliability|ai|ui|ops)\s*[:=]\s*([0-9.]+)', ultra, re.I):
    cats[m.group(1).lower()]=float(m.group(2))
score10=pathlib.Path('/tmp/score10.txt').read_text(encoding='utf-8',errors='ignore')
overall10=None
m=re.search(r'"overall"\s*:\s*([0-9.]+)', score10)
if m: overall10=float(m.group(1))
m2=re.search(r'"score"\s*:\s*\{([^}]+)\}', score10, re.S)
s10={}
if m2:
    for k,v in re.findall(r'"(security|reliability|ai|ui|ops)"\s*:\s*([0-9.]+)', m2.group(0)):
        s10[k]=float(v)
print(json.dumps({'ultra_cats':cats,'score10':s10,'overall10':overall10}, ensure_ascii=False, indent=2))
PY

echo C_AUDIT_0IH_DONE
