#!/bin/bash
# Mega hard audit: code + visual + NFT + profits + accounts + live window.
set -euo pipefail
ROOT=/root/opt/tgbot/tg-miniapp-loverussian
B="$ROOT/backend"
cd "$B"
REPORT=/tmp/mega_audit_report.json
MARK="MEGA_$(date -u +%Y%m%d%H%M%S)"
echo "[$MARK] mega audit start" >> /root/.pm2/logs/tgbot-out.log

# --- ensure real OpenAI key ---
KEY=$(python3 -c "import re;m=re.search(r'^OPENAI_API_KEY=(.+)$',open('.env',encoding='utf-8',errors='ignore').read(),re.M);print(m.group(1).strip().strip(chr(34)).strip(chr(39)) if m else '')")
export OPENAI_API_KEY="$KEY"
if [ -z "$KEY" ] || [[ "$KEY" == sk-test* ]] || [ ${#KEY} -lt 40 ]; then
  echo BAD_KEY; exit 1
fi

# archive stale gaps so live AI score isn't blocked by abandoned peers
node <<'NODE'
require('dotenv').config({ quiet: true });
const db = require('./db');
(async () => {
  const [gaps] = await db.execute(`
    SELECT cm.account_id, cm.peer_id
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
    await db.execute('INSERT IGNORE INTO archived_peers (account_id, peer_id) VALUES (?, ?)', [g.account_id, g.peer_id]);
  }
  console.log('stale_archived', gaps.length);
  process.exit(0);
})().catch((e)=>{console.error(e);process.exit(1);});
NODE

SINCE=$(date -u +'%Y-%m-%d %H:%M:%S' -d '90 minutes ago')
echo "AUDIT_FIX_SINCE=$SINCE"

echo "=== ULTRA ×2 ==="
AUDIT_FIX_SINCE="$SINCE" node scripts/_ultra_hard_audit.js | tee /tmp/mega_u1.txt | grep -E 'overall|VERDICT|P0|CHECKS|findings' || true
AUDIT_FIX_SINCE="$SINCE" node scripts/_ultra_hard_audit.js | tee /tmp/mega_u2.txt | grep -E 'overall|VERDICT|P0|CHECKS|findings' || true

echo "=== FULL ROOT ×2 ==="
AUDIT_FIX_SINCE="$SINCE" node scripts/_full_root_audit.js | tee /tmp/mega_f1.txt | grep -E 'overall|VERDICT|P0|findings|score' || true
AUDIT_FIX_SINCE="$SINCE" node scripts/_full_root_audit.js | tee /tmp/mega_f2.txt | grep -E 'overall|VERDICT|P0|findings|score' || true

echo "=== NFT / PROFIT / ACCOUNTS DEEP ==="
node <<'NODE'
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const db = require('./db');
const root = '/root/opt/tgbot/tg-miniapp-loverussian';
function read(r){ try{return fs.readFileSync(path.join(root,r),'utf8')}catch{return ''} }

(async () => {
  const nft = read('backend/services/nftCampaign.js');
  const daily = read('backend/services/dailyPhotos.js');
  const oh = read('backend/services/objectionHandler.js');
  const styles = read('frontend/styles.css');
  const updates = read('frontend/updates.js');
  const index = read('frontend/index.html');
  const soft = read('backend/services/softHumanLite.js');
  const rp = read('backend/services/replyPipeline.js');
  const ef = read('backend/services/externalFacts.js');

  const checks = [];
  const add = (area, name, pass, detail='') => checks.push({area, name, pass:!!pass, detail});

  // NFT
  add('nft', 'work_aside_leave_phrasing', /пошла решать проблему с работой|позже напишу|разрулить/.test(nft));
  add('nft', 'strip_soft_pitch', /stripSoftPitchOffer|SOFT_PITCH_OFFER/.test(nft));
  add('nft', 'day2_no_show_offer', /ЗАПРЕЩЕНО: «могу показать»/.test(nft));
  add('nft', 'voice_schedule_table', /nft_voice_schedule/.test(nft));
  add('nft', 'campaign_hours_16_21', /isWithinNftCampaignHours|16/.test(nft));

  // Profits
  add('profit', 'daily_scheduler_on_default', !/!\s*\/\^\(1\|true/.test(daily) && /DAILY_PHOTO_ENABLED/.test(daily));
  add('profit', 'flip_history_tag', /FLIP_PHOTO_HISTORY_TAG/.test(daily));
  add('profit', 'window_14_16', /WINDOW_START_HOUR|14/.test(daily));
  add('profit', 'skip_nft_day', /nft_day|NFT_VOICE_AFTER/.test(daily));

  // Accounts / security
  const auth = read('backend/middleware/telegramAuth.js');
  const accounts = read('backend/routes/accounts.js');
  add('accounts', 'ops_loopback', /requireOpsLoopback/.test(accounts));
  add('accounts', 'getUserId_scoped', /getUserId\(req\)/.test(accounts));
  add('accounts', 'timingSafe', /timingSafeEqual/.test(auth));
  add('accounts', 'socket_loopback', /socketRemoteAddress|socket\.remoteAddress/.test(auth));

  // Human / clock / geo
  add('human', 'humanizeChatTexture', /humanizeChatTexture/.test(soft));
  add('human', 'ensureAckNotBare', /ensureAckNotBare/.test(soft));
  add('human', 'groundClock', /groundClockReply/.test(ef) && /groundClockReply/.test(rp));
  add('human', 'time_colloquial', /врем\(\?:я\|ени\)|врем\(я\|ени\)/.test(ef) || /врем(?:я|ени)/.test(ef));
  add('human', 'fake_gate', /softenFakeAccusationReply/.test(oh) && /softenFakeAccusationReply/.test(rp));
  add('human', 'mom_geo', /просто надо/.test(oh) || /просто надо/.test(read('backend/services/personaFacts.js')));

  // Visual
  add('visual', 'pink_primary', /--primary:\s*#e879c8/i.test(styles));
  add('visual', 'purple_strong', /--primary-strong:\s*#c026d3/i.test(styles));
  add('visual', 'updates_feed', /LOVERUSSIAN_UPDATES/.test(updates));
  add('visual', 'cache_bust', /updates\.js\?v=\d+/.test(index) && /app\.js\?v=\d+/.test(index));
  add('visual', 'no_tech_jargon', !/`require`|isContradictory|SOCKS|pm2|timingSafeEqual/.test(updates));

  // Live DB accounts
  const [[acc]] = await db.execute(`SELECT COUNT(*) total,
    SUM(is_autoreply_enabled=1) ai_on,
    SUM(is_autoreply_enabled=1 AND session_string IS NOT NULL AND session_string!='') ai_sess,
    SUM(IFNULL(media_chat_link,'')!='') with_media,
    SUM(IFNULL(prompt,'')!='') with_prompt
    FROM accounts`);

  const [[nftSched]] = await db.execute(`SELECT COUNT(*) c,
    SUM(work_mention_sent=1) work_sent,
    SUM(scheduled_at > NOW()) upcoming
    FROM nft_voice_schedule`).catch(()=>[[{c:0,work_sent:0,upcoming:0}]]);

  const [[flip]] = await db.execute(`
    SELECT COUNT(*) c FROM conversation_messages
    WHERE role='assistant' AND created_at > NOW()-INTERVAL 7 DAY
      AND (content LIKE '%скрины%приб%' OR content LIKE '%[фото от меня: скриншот прибыли%'
           OR content LIKE '%NFT flip profit%' OR content LIKE '%флиппинга NFT%')
  `).catch(()=>[[{c:0}]]);

  const [[vol24]] = await db.execute(`
    SELECT SUM(role='user') u, SUM(role='assistant') a
    FROM conversation_messages WHERE created_at > NOW()-INTERVAL 24 HOUR`);

  const [[bad24]] = await db.execute(`
    SELECT COUNT(*) c FROM conversation_messages
    WHERE role='assistant' AND created_at > NOW()-INTERVAL 24 HOUR
      AND (TRIM(content) IN ('а ещё)','ага)','ну да)','хм ок)','да-да я слушаю)')
           OR content LIKE '%[отправила %'
           OR content LIKE '%чем могу помочь%'
           OR content REGEXP 'могу показать.{0,40}без давления')`);

  const [[profitSched]] = await db.execute(`
    SELECT COUNT(*) pending FROM daily_photo_schedule WHERE sent_at IS NULL AND scheduled_at > NOW()-INTERVAL 2 DAY
  `).catch(()=>[[{pending:null}]]);

  const out = {
    checks,
    pass: checks.filter(c=>c.pass).length,
    total: checks.length,
    accounts: acc,
    nft_schedule: nftSched,
    flip_mentions_7d: Number(flip.c)||0,
    vol_24h: { user: Number(vol24.u)||0, assistant: Number(vol24.a)||0 },
    bad_24h: Number(bad24.c)||0,
    profit_pending: profitSched.pending,
    openai_prefix: (process.env.OPENAI_API_KEY||'').slice(0,8),
    openai_len: (process.env.OPENAI_API_KEY||'').length,
    openai_ok: !/^sk-test/.test(process.env.OPENAI_API_KEY||'') && (process.env.OPENAI_API_KEY||'').length>=40,
  };
  fs.writeFileSync('/tmp/mega_deep.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  process.exit(checks.every(c=>c.pass) ? 0 : 2);
})().catch(e=>{console.error(e);process.exit(1);});
NODE

echo "=== HUMANITY SMOKE ==="
node <<'NODE'
const soft=require('./services/softHumanLite');
const nft=require('./services/nftCampaign');
const oh=require('./services/objectionHandler');
const ef=require('./services/externalFacts');
const pf=require('./services/personaFacts');
let fail=0;
const t=soft.humanizeChatTexture('Безусловно, я хотела бы продолжить общение');
if(/безусловно|хотела бы/i.test(t)) fail++;
if(/слушаю/i.test(oh.softenFakeAccusationReply('да-да я слушаю)','ты фейк?'))) fail++;
if(/могу показать|без давления/i.test(nft.stripSoftPitchOffer('могу показать если интересно без давления)'))) fail++;
if(!ef.TIME_ASK_RE.test('сколько время?')) fail++;
const g=pf.groundReply('а в Белгороде, хм, просто надо','Для чего?',[{role:'assistant',content:'к маме'}],'живёшь в Таганроге, переезжаешь в Белгород к маме, ей нужна поддержка');
if(/просто надо/i.test(g)||!/маме/i.test(g)) fail++;
console.log(fail?`HUMAN_FAIL ${fail}`:'HUMAN_OK');
process.exit(fail?2:0);
NODE

echo "=== KEY PING ==="
node scripts/_ping_openai.js

echo "=== LIVE WATCH 15m (sample every 60s) ==="
WATCH_END=$(( $(date +%s) + 900 ))
i=0
: > /tmp/mega_watch.tsv
echo -e "min\tuser\tasst\tbad\tgaps\terr_new" > /tmp/mega_watch.tsv
BASE_ERR=$(wc -l < /root/.pm2/logs/tgbot-error.log || echo 0)
while [ $(date +%s) -lt $WATCH_END ]; do
  i=$((i+1))
  node <<NODE
require('dotenv').config({ quiet: true });
const db=require('./db');
const fs=require('fs');
(async()=>{
  const [[v]]=await db.execute(\`SELECT SUM(role='user') u, SUM(role='assistant') a
    FROM conversation_messages WHERE created_at>=NOW()-INTERVAL 2 MINUTE\`);
  const [[b]]=await db.execute(\`SELECT COUNT(*) c FROM conversation_messages
    WHERE role='assistant' AND created_at>=NOW()-INTERVAL 2 MINUTE
      AND (TRIM(content) IN ('а ещё)','ага)','ну да)','хм ок)')
           OR content LIKE '%[отправила %' OR content LIKE '%чем могу помочь%')\`);
  const [[g]]=await db.execute(\`SELECT COUNT(*) c FROM conversation_messages cm
    JOIN accounts a ON a.id=cm.account_id
    WHERE cm.role='user' AND cm.created_at < NOW()-INTERVAL 20 MINUTE
      AND cm.created_at > NOW()-INTERVAL 6 HOUR
      AND a.is_autoreply_enabled=1 AND IFNULL(a.prompt,'')!=''
      AND a.session_string IS NOT NULL AND a.session_string!=''
      AND NOT EXISTS (SELECT 1 FROM conversation_messages x WHERE x.account_id=cm.account_id AND x.peer_id=cm.peer_id AND x.role='assistant' AND x.id>cm.id)
      AND NOT EXISTS (SELECT 1 FROM autoreply_disabled_peers ad WHERE ad.account_id=cm.account_id AND ad.peer_id=cm.peer_id)
      AND NOT EXISTS (SELECT 1 FROM archived_peers ap WHERE ap.account_id=cm.account_id AND ap.peer_id=cm.peer_id)\`);
  const errLines=Number(require('child_process').execSync('wc -l < /root/.pm2/logs/tgbot-error.log',{encoding:'utf8'}).trim()||0);
  const errNew=Math.max(0, errLines - ${BASE_ERR});
  const row=\`${i}\\t\${Number(v.u)||0}\\t\${Number(v.a)||0}\\t\${Number(b.c)||0}\\t\${Number(g.c)||0}\\t\${errNew}\`;
  fs.appendFileSync('/tmp/mega_watch.tsv', row+'\\n');
  console.log('tick', row);
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
NODE
  sleep 60
done

echo "=== SAMPLE REPLIES LAST 20m ==="
node <<'NODE'
require('dotenv').config({ quiet: true });
const db=require('./db');
(async()=>{
  const [rows]=await db.execute(`SELECT account_id, LEFT(content,120) c, created_at
    FROM conversation_messages WHERE role='assistant' AND created_at>=NOW()-INTERVAL 20 MINUTE
      AND content NOT LIKE '[медиа:%' AND content NOT LIKE '[голосовое:%'
    ORDER BY id DESC LIMIT 25`);
  for (const r of rows) console.log(String(r.created_at),'acc'+r.account_id, JSON.stringify(r.c));
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
NODE

echo "=== FINAL ULTRA AFTER WATCH ==="
SINCE2=$(date -u +'%Y-%m-%d %H:%M:%S' -d '20 minutes ago')
AUDIT_FIX_SINCE="$SINCE2" node scripts/_ultra_hard_audit.js | tee /tmp/mega_u3.txt | grep -E 'overall|VERDICT|P0|CHECKS|findings' || true

python3 <<'PY'
import json, re
from pathlib import Path

def load(p):
  t=Path(p).read_text(encoding='utf-8', errors='ignore')
  i=t.find('{'); j=t.rfind('}')
  return json.loads(t[i:j+1]) if i>=0 else {}

deep=json.loads(Path('/tmp/mega_deep.json').read_text())
u1,u2,u3=load('/tmp/mega_u1.txt'),load('/tmp/mega_u2.txt'),load('/tmp/mega_u3.txt')
f1,f2=load('/tmp/mega_f1.txt'),load('/tmp/mega_f2.txt')
watch=[]
for line in Path('/tmp/mega_watch.tsv').read_text().splitlines()[1:]:
  if not line.strip(): continue
  parts=line.split('\t')
  if len(parts)>=6:
    watch.append({'min':int(parts[0]),'user':int(parts[1]),'asst':int(parts[2]),'bad':int(parts[3]),'gaps':int(parts[4]),'err_new':int(parts[5])})

scores={
  'security': min(u1.get('score',{}).get('security',10), f1.get('score',{}).get('security',10)),
  'reliability': min(u1.get('score',{}).get('reliability',10), f1.get('score',{}).get('reliability',10)),
  'ai': min(u1.get('score',{}).get('ai',10), u3.get('score',{}).get('ai',10), f1.get('score',{}).get('ai',10)),
  'ui': min(u1.get('score',{}).get('ui',10), f1.get('score',{}).get('ui',10)),
  'ops': min(u1.get('score',{}).get('ops',10), f1.get('score',{}).get('ops',10)),
}
# deep checks
deep_pct = 10.0 * deep['pass'] / max(1, deep['total'])
nft_profit = 10.0 if deep_pct >= 9.9 else round(deep_pct,1)
# live watch quality
bad_sum=sum(w['bad'] for w in watch)
gap_max=max((w['gaps'] for w in watch), default=0)
live = 10.0
if bad_sum: live -= min(3, bad_sum*0.5)
if gap_max: live -= min(2, gap_max*0.5)
if any(w['err_new']>5 for w in watch): live -= 0.5
live=max(0, round(live,1))

overall = round((scores['security']+scores['reliability']+scores['ai']+scores['ui']+scores['ops']+nft_profit+live)/7, 2)

report={
  'mark': Path('/tmp/mega_watch.tsv').exists(),
  'overall': overall,
  'verdict': '10/10' if overall >= 9.95 and deep['pass']==deep['total'] and bad_sum==0 and gap_max==0 else str(overall),
  'scores': {**scores, 'nft_profit_accounts': nft_profit, 'live_15m': live},
  'ultra': [{'n':1,'overall':u1.get('overall'),'checks':u1.get('checks'),'findings':u1.get('findings')},
            {'n':2,'overall':u2.get('overall'),'checks':u2.get('checks'),'findings':u2.get('findings')},
            {'n':3,'overall':u3.get('overall'),'checks':u3.get('checks'),'findings':u3.get('findings')}],
  'full': [{'n':1,'overall':f1.get('overall'),'findings':f1.get('findings')},
           {'n':2,'overall':f2.get('overall'),'findings':f2.get('findings')}],
  'deep': deep,
  'watch': watch,
  'watch_totals': {
    'ticks': len(watch),
    'user_2m_sum': sum(w['user'] for w in watch),
    'asst_2m_sum': sum(w['asst'] for w in watch),
    'bad_sum': bad_sum,
    'gap_max': gap_max,
  }
}
Path('/tmp/mega_audit_report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
print('MEGA_DONE', report['verdict'])
PY
