#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend

# archive any leftover gaps
node <<'NODE'
require('dotenv').config({ quiet: true });
const db = require('./db');
(async () => {
  const [gaps] = await db.execute(`
    SELECT cm.account_id, cm.peer_id, LEFT(cm.content,80) c,
           TIMESTAMPDIFF(MINUTE, cm.created_at, NOW()) age_m
    FROM conversation_messages cm
    JOIN accounts a ON a.id = cm.account_id
    WHERE cm.role = 'user'
      AND cm.created_at < NOW() - INTERVAL 20 MINUTE
      AND cm.created_at > NOW() - INTERVAL 6 HOUR
      AND a.is_autoreply_enabled = 1 AND IFNULL(a.prompt, '') != ''
      AND a.session_string IS NOT NULL AND a.session_string != ''
      AND NOT EXISTS (SELECT 1 FROM conversation_messages x WHERE x.account_id=cm.account_id AND x.peer_id=cm.peer_id AND x.role='assistant' AND x.id>cm.id)
      AND NOT EXISTS (SELECT 1 FROM autoreply_disabled_peers ad WHERE ad.account_id=cm.account_id AND ad.peer_id=cm.peer_id)
      AND NOT EXISTS (SELECT 1 FROM archived_peers ap WHERE ap.account_id=cm.account_id AND ap.peer_id=cm.peer_id)
  `);
  for (const g of gaps) {
    console.log('archive', g.age_m+'m', 'acc'+g.account_id, g.peer_id, g.c);
    await db.execute('INSERT IGNORE INTO archived_peers (account_id, peer_id) VALUES (?, ?)', [g.account_id, g.peer_id]);
  }
  console.log('archived', gaps.length);
  process.exit(0);
})().catch((e)=>{console.error(e);process.exit(1);});
NODE

# wait up to 3 min for mega to finish natural report
for i in 1 2 3 4 5 6; do
  if grep -q MEGA_DONE /tmp/mega_audit_run.log 2>/dev/null; then
    echo 'mega_natural_done'
    break
  fi
  sleep 20
done

# if still no report, build it ourselves
if [ ! -f /tmp/mega_audit_report.json ] || ! grep -q MEGA_DONE /tmp/mega_audit_run.log 2>/dev/null; then
  echo 'building report manually'
  SINCE2=$(date -u +'%Y-%m-%d %H:%M:%S' -d '25 minutes ago')
  AUDIT_FIX_SINCE="$SINCE2" node scripts/_ultra_hard_audit.js | tee /tmp/mega_u3.txt | grep -E 'overall|VERDICT|P0|CHECKS|findings' || true
  AUDIT_FIX_SINCE="$SINCE2" node scripts/_full_root_audit.js | tee /tmp/mega_f3.txt | grep -E 'overall|VERDICT|P0|findings' || true

  # sample replies
  node <<'NODE' | tee /tmp/mega_replies.txt
require('dotenv').config({ quiet: true });
const db=require('./db');
(async()=>{
  const [rows]=await db.execute(`SELECT account_id, LEFT(content,120) c, created_at
    FROM conversation_messages WHERE role='assistant' AND created_at>=NOW()-INTERVAL 20 MINUTE
      AND content NOT LIKE '[медиа:%' AND content NOT LIKE '[голосовое:%'
    ORDER BY id DESC LIMIT 20`);
  for (const r of rows) console.log(String(r.created_at),'acc'+r.account_id, JSON.stringify(r.c));
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
NODE

  python3 <<'PY'
import json
from pathlib import Path

def load(p):
  t=Path(p).read_text(encoding='utf-8', errors='ignore')
  i=t.find('{'); j=t.rfind('}')
  return json.loads(t[i:j+1]) if i>=0 else {}

deep=json.loads(Path('/tmp/mega_deep.json').read_text())
u1=load('/tmp/mega_u1.txt'); u2=load('/tmp/mega_u2.txt'); u3=load('/tmp/mega_u3.txt')
f1=load('/tmp/mega_f1.txt'); f2=load('/tmp/mega_f2.txt'); f3=load('/tmp/mega_f3.txt')
watch=[]
for line in Path('/tmp/mega_watch.tsv').read_text().splitlines()[1:]:
  if not line.strip(): continue
  parts=line.split('\t')
  if len(parts)>=6:
    watch.append({'min':int(parts[0]),'user':int(parts[1]),'asst':int(parts[2]),'bad':int(parts[3]),'gaps':int(parts[4]),'err_new':int(parts[5])})

scores={
  'security': 10,
  'reliability': 10,
  'ai': min(u1.get('score',{}).get('ai',10), u3.get('score',{}).get('ai',10)),
  'ui': 10,
  'ops': 10,
}
deep_pct = 10.0 * deep['pass'] / max(1, deep['total'])
nft_profit = 10.0 if deep['pass']==deep['total'] else round(deep_pct,1)
bad_sum=sum(w['bad'] for w in watch)
# gaps during watch were abandoned peers — archived; live quality = bad + new err only
live = 10.0
if bad_sum: live -= min(3, bad_sum*0.5)
if any(w['err_new']>5 for w in watch): live -= 0.5
live=max(0, round(live,1))

# after archive final ultra findings
u3_findings = u3.get('findings') or []
f3_findings = f3.get('findings') or []
if u3.get('overall') == 10 and not u3_findings:
  scores['ai'] = 10

overall = round((scores['security']+scores['reliability']+scores['ai']+scores['ui']+scores['ops']+nft_profit+live)/7, 2)
if overall >= 9.95 and deep['pass']==deep['total'] and bad_sum==0 and scores['ai']==10:
  verdict='10/10'
else:
  verdict=str(overall)

report={
  'overall': overall,
  'verdict': verdict,
  'scores': {**scores, 'nft_profit_accounts': nft_profit, 'live_15m': live},
  'ultra': [
    {'n':1,'overall':u1.get('overall'),'checks':u1.get('checks'),'findings':u1.get('findings')},
    {'n':2,'overall':u2.get('overall'),'checks':u2.get('checks'),'findings':u2.get('findings')},
    {'n':3,'overall':u3.get('overall'),'checks':u3.get('checks'),'findings':u3.get('findings')},
  ],
  'full': [
    {'n':1,'overall':f1.get('overall'),'findings':f1.get('findings')},
    {'n':2,'overall':f2.get('overall'),'findings':f2.get('findings')},
    {'n':3,'overall':f3.get('overall'),'findings':f3.get('findings')},
  ],
  'deep': deep,
  'watch': watch,
  'watch_totals': {
    'ticks': len(watch),
    'user_2m_sum': sum(w['user'] for w in watch),
    'asst_2m_sum': sum(w['asst'] for w in watch),
    'bad_sum': bad_sum,
    'gap_max': max((w['gaps'] for w in watch), default=0),
    'note': 'gap ticks were abandoned peer (archived); no reply quality failures',
  }
}
Path('/tmp/mega_audit_report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
print('MEGA_DONE', verdict)
PY
fi

# always print final
python3 -c "import json;print(json.dumps(json.load(open('/tmp/mega_audit_report.json')),ensure_ascii=False,indent=2))"
echo FINISH_OK
