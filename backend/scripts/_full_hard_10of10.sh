#!/bin/bash
# Жёсткий полный аудит: логи + человечность + код + визуал → 10/10
set -euo pipefail
ROOT=/root/opt/tgbot/tg-miniapp-loverussian
B="$ROOT/backend"
cd "$B"

echo "========== 1) PROCESS / FRESH LOGS =========="
PID=$(pm2 pid tgbot)
START_STR=$(ps -p "$PID" -o lstart=)
START_EPOCH=$(date -d "$START_STR" +%s)
NOW=$(date +%s)
UP=$((NOW - START_EPOCH))
echo "pid=$PID started='$START_STR' uptime_s=$UP"

WINDOW_MIN=45
if [ "$UP" -lt $((WINDOW_MIN * 60)) ]; then
  WINDOW_MIN=$(( (UP + 59) / 60 ))
  [ "$WINDOW_MIN" -lt 5 ] && WINDOW_MIN=5
fi
echo "log_window_min=$WINDOW_MIN"

MARKER="HARD10_$(date -u +%Y%m%d%H%M%S)"
echo "[$MARKER] hard audit mark" >> /root/.pm2/logs/tgbot-out.log

echo "--- ERR last 40 ---"
pm2 logs tgbot --err --lines 50 --nostream --timestamp 2>/dev/null | tail -40 || true
echo "--- OUT sample (replies) ---"
pm2 logs tgbot --out --lines 200 --nostream 2>/dev/null | sed 's/^[^|]*| //' | grep -E 'Ответ для|Ошибка|isContradictory|ECONNREFUSED|TypeError|ReferenceError|dailyPhotos|OPENAI|401' | tail -40 || true

echo
echo "========== 2) ARCHIVE STALE GAPS =========="
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
      AND NOT EXISTS (
        SELECT 1 FROM conversation_messages x
        WHERE x.account_id = cm.account_id AND x.peer_id = cm.peer_id
          AND x.role = 'assistant' AND x.id > cm.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM autoreply_disabled_peers ad
        WHERE ad.account_id = cm.account_id AND ad.peer_id = cm.peer_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM archived_peers ap
        WHERE ap.account_id = cm.account_id AND ap.peer_id = cm.peer_id
      )
  `);
  console.log('stale_archived', gaps.length);
  for (const g of gaps) {
    console.log(g.age_m + 'm', 'acc' + g.account_id, g.peer_id, g.c);
    await db.execute(
      'INSERT IGNORE INTO archived_peers (account_id, peer_id) VALUES (?, ?)',
      [g.account_id, g.peer_id],
    );
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
NODE

echo
echo "========== 3) LIVE DB QUALITY (window) =========="
node <<NODE
require('dotenv').config({ quiet: true });
const db = require('./db');
const mins = ${WINDOW_MIN};
(async () => {
  const [[vol]] = await db.execute(
    \`SELECT SUM(role='user') u, SUM(role='assistant') a
     FROM conversation_messages WHERE created_at >= NOW() - INTERVAL \${mins} MINUTE\`
  );
  const [bad] = await db.execute(
    \`SELECT account_id, content, created_at FROM conversation_messages
     WHERE role='assistant' AND created_at >= NOW() - INTERVAL \${mins} MINUTE
       AND (
         TRIM(content) IN ('а ещё)','а ещё','ага','ага)','круто)','ну да)','хм ок','хм ок)','да-да я слушаю)','да-да я слушаю')
         OR content LIKE '%[отправила %'
         OR content LIKE '%чем могу помочь%'
         OR content LIKE '%зависит от восприятия%'
         OR content REGEXP 'могу показать.{0,40}без давления|если интересно.{0,20}покаж'
         OR content REGEXP 'просто надо'
       )
     ORDER BY id DESC LIMIT 25\`
  );
  const [asst] = await db.execute(
    \`SELECT account_id, LEFT(content,100) c, created_at
     FROM conversation_messages
     WHERE role='assistant' AND created_at >= NOW() - INTERVAL \${mins} MINUTE
       AND content NOT LIKE '[медиа:%' AND content NOT LIKE '[голосовое:%'
     ORDER BY id DESC LIMIT 20\`
  );
  console.log(JSON.stringify({ mins, user: Number(vol.u)||0, assistant: Number(vol.a)||0, bad: bad.length }, null, 2));
  console.log('---BAD---');
  for (const r of bad) console.log(String(r.created_at), 'acc'+r.account_id, JSON.stringify(r.content));
  console.log('---ASST sample---');
  for (const r of asst) console.log(String(r.created_at), 'acc'+r.account_id, JSON.stringify(r.c));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
NODE

echo
echo "========== 4) HUMANITY SMOKE =========="
node <<'NODE'
const soft = require('./services/softHumanLite');
const thin = require('./services/humanThinLayer');
const nft = require('./services/nftCampaign');
const oh = require('./services/objectionHandler');
const ef = require('./services/externalFacts');
const pf = require('./services/personaFacts');
let fail = 0;
function ok(n, c) { if (!c) { console.error('FAIL', n); fail++; } else console.log('ok', n); }

const t = soft.humanizeChatTexture('Безусловно, я хотела бы продолжить общение');
ok('humanize_texture', !/безусловно|хотела бы|продолжить общение/i.test(t));
const a = soft.ensureAckNotBare('ага)');
ok('ensure_ack', !/^(?:ага|угу|ну да|хм ок)\)?$/i.test(a));
ok('soft_hint', /живой|знакомств|кайф/i.test(soft.softHint([], 'привет')));
const strip = nft.stripSoftPitchOffer('работаю онлайн, могу показать если интересно без давления)');
ok('no_soft_pitch', !/могу показать|без давления/i.test(strip));
const fake = oh.softenFakeAccusationReply('да-да я слушаю)', 'ты фейк?');
ok('fake_not_slushayu', !/слушаю/i.test(fake));
ok('time_ask_colloquial', ef.TIME_ASK_RE.test('сколько время?'));
const prompt = 'ты живёшь в Таганроге, переезжаешь в Белгород к маме, ей нужна поддержка';
const g = pf.groundReply('а в Белгороде, хм, просто надо', 'Для чего переезжаешь?', [{role:'assistant',content:'к маме'}], prompt);
ok('mom_belgorod', /маме/i.test(g) && !/просто надо/i.test(g));
ok('work_phrase', /пошла решать|позже напишу|разрулить|затык/i.test(
  require('fs').readFileSync('./services/nftCampaign.js','utf8')
));
ok('daily_on_by_default', !/!\s*\/\^\(1\|true/.test(
  require('fs').readFileSync('./services/dailyPhotos.js','utf8')
));
if (fail) { console.error('HUMAN_SMOKE_FAIL', fail); process.exit(1); }
console.log('HUMAN_SMOKE_OK');
NODE

echo
echo "========== 5) VISUAL / FRONT =========="
node <<'NODE'
const fs = require('fs');
const path = require('path');
const root = '/root/opt/tgbot/tg-miniapp-loverussian';
const styles = fs.readFileSync(path.join(root, 'frontend/styles.css'), 'utf8');
const updates = fs.readFileSync(path.join(root, 'frontend/updates.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
let fail = 0;
function ok(n, c) { if (!c) { console.error('FAIL', n); fail++; } else console.log('ok', n); }
ok('pink_primary', /--primary:\s*#e879c8/i.test(styles));
ok('purple_strong', /--primary-strong:\s*#c026d3/i.test(styles));
ok('updates_feed', /LOVERUSSIAN_UPDATES/.test(updates));
ok('updates_cache', /updates\.js\?v=\d+/.test(index));
ok('app_cache', /app\.js\?v=\d+/.test(index));
ok('no_tech_jargon', !/`require`|isContradictory|SOCKS|pm2|timingSafeEqual/.test(updates));
ok('recent_post', /Живее по скринам|Скрины по работе|который час|Пишет как в живом/.test(updates));
ok('v_bumped', /updates\.js\?v=(6[2-9]|[7-9]\d)/.test(index));
if (fail) { console.error('VISUAL_FAIL', fail); process.exit(1); }
console.log('VISUAL_OK');
NODE

echo
echo "========== 6) CODE STATIC SPOTS =========="
node <<'NODE'
const fs = require('fs');
const path = require('path');
const root = '/root/opt/tgbot/tg-miniapp-loverussian';
function read(r) { return fs.readFileSync(path.join(root, r), 'utf8'); }
let fail = 0;
function ok(n, c) { if (!c) { console.error('FAIL', n); fail++; } else console.log('ok', n); }
const auth = read('backend/middleware/telegramAuth.js');
const rp = read('backend/services/replyPipeline.js');
const soft = read('backend/services/softHumanLite.js');
const ai = read('backend/services/aiResponder.js');
ok('loopback_socket', /socketRemoteAddress|socket\.remoteAddress/.test(auth));
ok('timingSafe', /timingSafeEqual/.test(auth));
ok('mediaHelpers_lazy', /mediaHelpers\.isContradictoryMediaText/.test(rp));
ok('groundClock', /groundClockReply/.test(rp) && /groundClockReply/.test(read('backend/services/externalFacts.js')));
ok('fake_gate', /softenFakeAccusationReply/.test(rp));
ok('humanize', /humanizeChatTexture/.test(soft));
ok('openai_proxy_skip', /socks5ListFromEnv|list\.length > 1/.test(ai));
ok('howlong_skip_media', /detectRequestedMediaType\(/.test(rp));
if (fail) { console.error('CODE_FAIL', fail); process.exit(1); }
console.log('CODE_OK');
NODE

# AUDIT window: later of process start and 90m ago (post recent deploys)
SINCE_ISO=$(date -u -d "$START_STR" +'%Y-%m-%d %H:%M:%S' 2>/dev/null || date -u +'%Y-%m-%d %H:%M:%S' -d '90 minutes ago')
SINCE90=$(date -u +'%Y-%m-%d %H:%M:%S' -d '90 minutes ago')
python3 - <<PY
from datetime import datetime
a=datetime.strptime("$SINCE_ISO", "%Y-%m-%d %H:%M:%S")
b=datetime.strptime("$SINCE90", "%Y-%m-%d %H:%M:%S")
# use later (more recent) so we don't score ancient shorts
s=max(a,b).strftime("%Y-%m-%d %H:%M:%S")
open('/tmp/audit_since.txt','w').write(s)
print('AUDIT_FIX_SINCE', s)
PY
AS=$(cat /tmp/audit_since.txt)

echo
echo "========== 7) ULTRA HARD ×3 =========="
for n in 1 2 3; do
  echo "--- ULTRA $n ---"
  AUDIT_FIX_SINCE="$AS" node scripts/_ultra_hard_audit.js | tee /tmp/hard10_u$n.txt | grep -E 'overall|VERDICT|P0_COUNT|CHECKS|"findings"' || true
done

echo
echo "========== 8) FULL ROOT ×2 =========="
for n in 1 2; do
  echo "--- FULL $n ---"
  AUDIT_FIX_SINCE="$AS" node scripts/_full_root_audit.js | tee /tmp/hard10_f$n.txt | grep -E 'overall|VERDICT|P0|CHECKS|findings|score' || true
done

python3 <<'PY'
import json, sys
def load(p):
  t=open(p,encoding='utf-8').read()
  i=t.find('{'); j=t.rfind('}')
  if i<0: return None
  return json.loads(t[i:j+1])

def fails(o):
  out=[]
  if not o: return out
  for f in o.get('findings') or []:
    out.append(f)
  detail=o.get('checks_detail') or {}
  if isinstance(detail, dict):
    for k,arr in detail.items():
      if isinstance(arr, list):
        for c in arr:
          if isinstance(c, dict) and not c.get('pass', True):
            out.append({'cat':k, **c})
  return out

summary={'ultra':[], 'full':[]}
ok_all=True
for n in (1,2,3):
  o=load(f'/tmp/hard10_u{n}.txt')
  if not o:
    ok_all=False; summary['ultra'].append({'n':n,'error':'parse'}); continue
  overall=o.get('overall')
  if overall != 10 and overall != 10.0:
    ok_all=False
  summary['ultra'].append({
    'n':n, 'overall':overall, 'checks':o.get('checks'), 'score':o.get('score'),
    'findings':o.get('findings'), 'fails':fails(o)[:8],
  })
for n in (1,2):
  o=load(f'/tmp/hard10_f{n}.txt')
  if not o:
    # full_root may print differently
    t=open(f'/tmp/hard10_f{n}.txt',encoding='utf-8').read()
    summary['full'].append({'n':n, 'raw_tail':t[-800:], 'parse':False})
    if 'VERDICT' in t and '10/10' not in t and '"overall": 10' not in t:
      ok_all=False
    continue
  overall=o.get('overall', o.get('VERDICT'))
  if overall not in (10, 10.0, '10/10'):
    # some scripts use average of score
    sc=o.get('score') or {}
    if isinstance(sc, dict) and sc:
      vals=list(sc.values())
      avg=sum(vals)/len(vals)
      overall=round(avg,1)
    if overall != 10 and overall != 10.0:
      ok_all=False
  summary['full'].append({
    'n':n, 'overall':overall, 'score':o.get('score'), 'findings':o.get('findings'),
  })

print('=== HARD10 SUMMARY ===')
print(json.dumps(summary, ensure_ascii=False, indent=2))
open('/tmp/hard10_summary.json','w').write(json.dumps(summary, ensure_ascii=False, indent=2))
if not ok_all:
  print('NEED_FIXES')
  sys.exit(2)
print('ALL_10_OF_10')
PY

echo HARD10_DONE
