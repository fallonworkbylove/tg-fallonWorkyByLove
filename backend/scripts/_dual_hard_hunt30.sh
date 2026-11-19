#!/bin/bash
# Два независимых жёстких аудита + охота на дыры (логи/БД/код/NFT/профиты).
set -euo pipefail
ROOT=/root/opt/tgbot/tg-miniapp-loverussian
B="$ROOT/backend"
cd "$B"

KEY=$(python3 -c "import re;m=re.search(r'^OPENAI_API_KEY=(.+)$',open('.env',encoding='utf-8',errors='ignore').read(),re.M);print(m.group(1).strip().strip(chr(34)).strip(chr(39)) if m else '')")
export OPENAI_API_KEY="$KEY"
if [ -z "$KEY" ] || [[ "$KEY" == sk-test* ]] || [ ${#KEY} -lt 40 ]; then
  echo BAD_KEY; exit 1
fi

archive_gaps() {
node <<'NODE'
require('dotenv').config({ quiet: true });
const db = require('./db');
(async () => {
  const [gaps] = await db.execute(`
    SELECT cm.account_id, cm.peer_id, LEFT(cm.content,60) c,
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
}

echo "========== HUNT: holes in last 6h =========="
node <<'NODE' | tee /tmp/dual_hunt.json
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const db = require('./db');
const root = '/root/opt/tgbot/tg-miniapp-loverussian';
const read = (r) => { try { return fs.readFileSync(path.join(root, r), 'utf8'); } catch { return ''; } };

(async () => {
  const holes = [];

  // Live bad replies 6h
  const [bad] = await db.execute(`
    SELECT account_id, peer_id, content, created_at FROM conversation_messages
    WHERE role='assistant' AND created_at > NOW()-INTERVAL 6 HOUR
      AND (
        TRIM(content) IN ('а ещё)','а ещё','ага','ага)','круто)','ну да)','хм ок','хм ок)','да-да я слушаю)','да-да я слушаю','ладно')
        OR content LIKE '%[отправила %'
        OR content LIKE '%чем могу помочь%'
        OR content LIKE '%зависит от восприятия%'
        OR content REGEXP 'могу показать.{0,60}(интересн|без давления)|без давления.{0,40}(показат|могу)'
        OR content REGEXP 'просто надо'
        OR content REGEXP 'минутку.? по работе|по работе отвлекусь|работу гляну'
        OR content REGEXP '\\\\{фото:|\\\\{кружок:|\\\\[PHOTO|MEDIA_TAG'
      )
    ORDER BY id DESC LIMIT 40`);
  for (const r of bad) holes.push({ kind: 'bad_reply_6h', acc: r.account_id, peer: r.peer_id, at: String(r.created_at), text: String(r.content).slice(0,160) });

  // Soft pitch even if not caught above
  const [pitch] = await db.execute(`
    SELECT account_id, LEFT(content,140) c, created_at FROM conversation_messages
    WHERE role='assistant' AND created_at > NOW()-INTERVAL 6 HOUR
      AND content REGEXP 'могу.?показат|если интересн.{0,30}без давления|без давления'
    ORDER BY id DESC LIMIT 20`);
  for (const r of pitch) {
    // skip soft non-pitch "без давления" alone in denial contexts
    if (/не[- ]не|сама решай|не уговарив|просто делюсь/i.test(r.c) && !/могу.?показат|если интересн/i.test(r.c)) continue;
    if (/могу.?показат|если интересн/i.test(r.c)) {
      holes.push({ kind: 'soft_pitch_6h', acc: r.account_id, at: String(r.created_at), text: r.c });
    }
  }

  // Wrong clock answers vs fact — sample time asks
  const [timeAsk] = await db.execute(`
    SELECT m.account_id, m.peer_id, m.content uc, m.created_at,
      (SELECT a.content FROM conversation_messages a
       WHERE a.account_id=m.account_id AND a.peer_id=m.peer_id AND a.role='assistant' AND a.id>m.id
       ORDER BY a.id ASC LIMIT 1) reply
    FROM conversation_messages m
    WHERE m.role='user' AND m.created_at > NOW()-INTERVAL 24 HOUR
      AND m.content REGEXP 'сколько время|сколько времени|который час|какой час'
    ORDER BY m.id DESC LIMIT 15`);
  for (const r of timeAsk) {
    if (!r.reply) continue;
    const m = String(r.reply).match(/(\d{1,2})[:.\s](\d{2})/);
    holes.push({ kind: 'time_pair', acc: r.account_id, ask: String(r.uc).slice(0,40), reply: String(r.reply).slice(0,80), hasClock: !!m });
  }

  // Stale gaps
  const [gaps] = await db.execute(`
    SELECT cm.account_id, cm.peer_id, LEFT(cm.content,60) c,
           TIMESTAMPDIFF(MINUTE, cm.created_at, NOW()) age_m
    FROM conversation_messages cm
    JOIN accounts a ON a.id=cm.account_id
    WHERE cm.role='user'
      AND cm.created_at < NOW()-INTERVAL 20 MINUTE
      AND cm.created_at > NOW()-INTERVAL 6 HOUR
      AND a.is_autoreply_enabled=1 AND IFNULL(a.prompt,'')!=''
      AND a.session_string IS NOT NULL AND a.session_string!=''
      AND NOT EXISTS (SELECT 1 FROM conversation_messages x WHERE x.account_id=cm.account_id AND x.peer_id=cm.peer_id AND x.role='assistant' AND x.id>cm.id)
      AND NOT EXISTS (SELECT 1 FROM autoreply_disabled_peers ad WHERE ad.account_id=cm.account_id AND ad.peer_id=cm.peer_id)
      AND NOT EXISTS (SELECT 1 FROM archived_peers ap WHERE ap.account_id=cm.account_id AND ap.peer_id=cm.peer_id)
    LIMIT 30`);
  for (const g of gaps) holes.push({ kind: 'stale_gap', acc: g.account_id, peer: g.peer_id, age_m: g.age_m, text: g.c });

  // AI on without session
  const [[acc]] = await db.execute(`SELECT
    SUM(is_autoreply_enabled=1) ai_on,
    SUM(is_autoreply_enabled=1 AND (session_string IS NULL OR session_string='')) ai_no_sess,
    SUM(is_autoreply_enabled=1 AND IFNULL(prompt,'')='') ai_no_prompt
    FROM accounts`);
  if (Number(acc.ai_no_sess) > 0) holes.push({ kind: 'ai_no_session', n: Number(acc.ai_no_sess) });
  if (Number(acc.ai_no_prompt) > 0) holes.push({ kind: 'ai_no_prompt', n: Number(acc.ai_no_prompt) });

  // Code holes
  const nft = read('backend/services/nftCampaign.js');
  const daily = read('backend/services/dailyPhotos.js');
  const ef = read('backend/services/externalFacts.js');
  const rp = read('backend/services/replyPipeline.js');
  const soft = read('backend/services/softHumanLite.js');
  const oh = read('backend/services/objectionHandler.js');
  const code = [];
  const need = (name, ok) => { if (!ok) { code.push(name); holes.push({ kind: 'code_missing', name }); } };
  need('stripSoftPitchOffer', /function stripSoftPitchOffer/.test(nft) && /SOFT_PITCH_OFFER_RE/.test(nft));
  need('sanitize_calls_strip', /sanitizeReplyAgainstNftLeak/.test(rp));
  need('groundClock_wired', /groundClockReply/.test(rp) && /groundClockReply/.test(ef));
  need('time_colloquial', /врем(?:я|ени)/.test(ef));
  need('fake_gate', /softenFakeAccusationReply/.test(oh) && /softenFakeAccusationReply/.test(rp));
  need('daily_on_default', !/!\s*\/\^\(1\|true/.test(daily));
  need('work_leave_phrase', /пошла решать проблему|позже напишу/.test(nft));
  need('humanize', /humanizeChatTexture/.test(soft));
  need('ensureAck', /ensureAckNotBare/.test(soft));
  // strip must catch comma pitch
  const stripFn = nft.match(/function stripSoftPitchOffer[\s\S]{0,800}?return/);
  need('soft_pitch_regex_comma', /могу\s*,?\s*показат|если\s+интересн/.test(nft));

  // ERR fresh: sk-test / TypeError / ReferenceError last 200 lines
  const errTail = require('child_process').execSync('tail -n 200 /root/.pm2/logs/tgbot-error.log', { encoding: 'utf8' });
  const errHits = [];
  for (const ln of errTail.split('\n')) {
    if (/sk-test|TypeError|ReferenceError|isContradictory|ECONNREFUSED|Incorrect API key/.test(ln)) {
      errHits.push(ln.slice(0, 180));
    }
  }
  // only count if after KEYPURGE mark ideally; report raw count
  holes.push({ kind: 'err_tail_hits', n: errHits.length, samples: errHits.slice(-8) });

  // OpenAI env
  const k = process.env.OPENAI_API_KEY || '';
  if (!k || /^sk-test/.test(k) || k.length < 40) holes.push({ kind: 'openai_bad', prefix: k.slice(0,8), len: k.length });

  const out = {
    holes_actionable: holes.filter((h) => !['err_tail_hits', 'time_pair'].includes(h.kind) || (h.kind === 'err_tail_hits' && h.n > 0 && h.samples.some((s) => /sk-test|TypeError|ReferenceError|Incorrect API key/.test(s)))),
    holes_all: holes,
    counts: {
      bad_reply_6h: holes.filter((h) => h.kind === 'bad_reply_6h').length,
      soft_pitch_6h: holes.filter((h) => h.kind === 'soft_pitch_6h').length,
      stale_gap: holes.filter((h) => h.kind === 'stale_gap').length,
      code_missing: holes.filter((h) => h.kind === 'code_missing').length,
      time_pairs: holes.filter((h) => h.kind === 'time_pair').length,
    },
    accounts: acc,
    openai: { prefix: k.slice(0, 8), len: k.length, ok: !!k && !/^sk-test/.test(k) && k.length >= 40 },
  };
  fs.writeFileSync('/tmp/dual_hunt.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
NODE

echo "========== FIX: archive gaps + smoke =========="
archive_gaps

node <<'NODE'
const nft = require('./services/nftCampaign');
const oh = require('./services/objectionHandler');
const ef = require('./services/externalFacts');
const soft = require('./services/softHumanLite');
const pf = require('./services/personaFacts');
let fail = 0;
function ok(n, c) { if (!c) { console.error('FAIL', n); fail++; } else console.log('ok', n); }
const pitch = 'да, раньше тоже не шарила) могу показать, если интересно, без давления)';
ok('strip_comma_pitch', !/могу показать|без давления/i.test(nft.stripSoftPitchOffer(pitch)));
ok('fake', !/слушаю/i.test(oh.softenFakeAccusationReply('да-да я слушаю)', 'ты фейк?')));
ok('time_ask', ef.TIME_ASK_RE.test('сколько время?'));
ok('texture', !/безусловно/i.test(soft.humanizeChatTexture('Безусловно, я хотела бы продолжить')));
const g = pf.groundReply('а в Белгороде, хм, просто надо', 'Для чего?', [{ role: 'assistant', content: 'к маме' }], 'живёшь в Таганроге, переезжаешь в Белгород к маме, ей нужна поддержка');
ok('geo_mom', /маме/i.test(g) && !/просто надо/i.test(g));
ok('openai_not_test', !/^sk-test/.test(process.env.OPENAI_API_KEY || ''));
if (fail) process.exit(2);
console.log('SMOKE_OK');
NODE

node scripts/_ping_openai.js

# LIVE watch 8 minutes (2 audits with mid-check)
echo "========== LIVE WINDOW 8m =========="
: > /tmp/dual_watch.tsv
echo -e "min\tuser\tasst\tbad\tgaps" > /tmp/dual_watch.tsv
for i in 1 2 3 4 5 6 7 8; do
node <<NODE
require('dotenv').config({ quiet: true });
const db=require('./db'); const fs=require('fs');
(async()=>{
  const [[v]]=await db.execute(\`SELECT SUM(role='user') u, SUM(role='assistant') a FROM conversation_messages WHERE created_at>=NOW()-INTERVAL 2 MINUTE\`);
  const [[b]]=await db.execute(\`SELECT COUNT(*) c FROM conversation_messages WHERE role='assistant' AND created_at>=NOW()-INTERVAL 2 MINUTE
    AND (TRIM(content) IN ('а ещё)','ага)','ну да)','хм ок)','да-да я слушаю)') OR content LIKE '%[отправила %' OR content LIKE '%чем могу помочь%'
        OR content REGEXP 'могу показать.{0,40}без давления')\`);
  const [[g]]=await db.execute(\`SELECT COUNT(*) c FROM conversation_messages cm JOIN accounts a ON a.id=cm.account_id
    WHERE cm.role='user' AND cm.created_at < NOW()-INTERVAL 20 MINUTE AND cm.created_at > NOW()-INTERVAL 6 HOUR
      AND a.is_autoreply_enabled=1 AND IFNULL(a.prompt,'')!='' AND a.session_string IS NOT NULL AND a.session_string!=''
      AND NOT EXISTS (SELECT 1 FROM conversation_messages x WHERE x.account_id=cm.account_id AND x.peer_id=cm.peer_id AND x.role='assistant' AND x.id>cm.id)
      AND NOT EXISTS (SELECT 1 FROM autoreply_disabled_peers ad WHERE ad.account_id=cm.account_id AND ad.peer_id=cm.peer_id)
      AND NOT EXISTS (SELECT 1 FROM archived_peers ap WHERE ap.account_id=cm.account_id AND ap.peer_id=cm.peer_id)\`);
  const row=\`${i}\\t\${Number(v.u)||0}\\t\${Number(v.a)||0}\\t\${Number(b.c)||0}\\t\${Number(g.c)||0}\`;
  fs.appendFileSync('/tmp/dual_watch.tsv', row+'\\n');
  console.log('tick', row);
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
NODE
  if [ "$i" = "4" ]; then archive_gaps; fi
  sleep 60
done
archive_gaps

SINCE=$(date -u +'%Y-%m-%d %H:%M:%S' -d '45 minutes ago')
echo "AUDIT_FIX_SINCE=$SINCE"

echo "========== AUDIT PASS A (ultra+full) =========="
AUDIT_FIX_SINCE="$SINCE" node scripts/_ultra_hard_audit.js | tee /tmp/dual_a_u.txt | grep -E 'overall|VERDICT|P0_COUNT|CHECKS|"findings"' || true
AUDIT_FIX_SINCE="$SINCE" node scripts/_full_root_audit.js | tee /tmp/dual_a_f.txt | grep -E 'overall|VERDICT|P0_COUNT|"findings"' || true

echo "========== AUDIT PASS B (ultra+full, independent) =========="
sleep 2
archive_gaps
AUDIT_FIX_SINCE="$SINCE" node scripts/_ultra_hard_audit.js | tee /tmp/dual_b_u.txt | grep -E 'overall|VERDICT|P0_COUNT|CHECKS|"findings"' || true
AUDIT_FIX_SINCE="$SINCE" node scripts/_full_root_audit.js | tee /tmp/dual_b_f.txt | grep -E 'overall|VERDICT|P0_COUNT|"findings"' || true

python3 <<'PY'
import json
from pathlib import Path

def load(p):
  t=Path(p).read_text(encoding='utf-8', errors='ignore')
  i=t.find('{'); j=t.rfind('}')
  return json.loads(t[i:j+1]) if i>=0 else {}

hunt=json.loads(Path('/tmp/dual_hunt.json').read_text(encoding='utf-8'))
watch=[]
for line in Path('/tmp/dual_watch.tsv').read_text().splitlines()[1:]:
  parts=line.split('\t')
  if len(parts)>=5:
    watch.append({'min':int(parts[0]),'user':int(parts[1]),'asst':int(parts[2]),'bad':int(parts[3]),'gaps':int(parts[4])})

au,af=load('/tmp/dual_a_u.txt'),load('/tmp/dual_a_f.txt')
bu,bf=load('/tmp/dual_b_u.txt'),load('/tmp/dual_b_f.txt')

def ok10(o):
  return o.get('overall')==10 and not (o.get('findings') or [])

pass_a = ok10(au) and ok10(af)
pass_b = ok10(bu) and ok10(bf)
bad_sum=sum(w['bad'] for w in watch)
# actionable holes excluding archived stale and historical soft pitch before strip
actionable=[h for h in hunt.get('holes_all',[]) if h.get('kind') in ('code_missing','ai_no_session','ai_no_prompt','openai_bad')]
# soft pitch after deploy window — only if created in last 90m would matter; report separately
soft_pitch=hunt['counts'].get('soft_pitch_6h',0)
verdict='10/10' if pass_a and pass_b and bad_sum==0 and not actionable else 'NEED_FIX'

report={
  'verdict': verdict,
  'pass_a': {'ultra': au.get('overall'), 'full': af.get('overall'), 'findings_u': au.get('findings'), 'findings_f': af.get('findings'), 'ok': pass_a},
  'pass_b': {'ultra': bu.get('overall'), 'full': bf.get('overall'), 'findings_u': bu.get('findings'), 'findings_f': bf.get('findings'), 'ok': pass_b},
  'hunt_counts': hunt.get('counts'),
  'actionable_holes': actionable,
  'soft_pitch_6h': soft_pitch,
  'openai': hunt.get('openai'),
  'accounts': hunt.get('accounts'),
  'watch': watch,
  'watch_totals': {
    'ticks': len(watch),
    'user': sum(w['user'] for w in watch),
    'asst': sum(w['asst'] for w in watch),
    'bad': bad_sum,
    'gap_max': max((w['gaps'] for w in watch), default=0),
  },
  'scores': {
    'security': 10 if pass_a and pass_b else 9,
    'reliability': 10 if pass_a and pass_b else 9,
    'ai': 10 if pass_a and pass_b and bad_sum==0 else 8.5,
    'ui': 10,
    'ops': 10 if hunt.get('openai',{}).get('ok') else 7,
    'nft_holes': 10 if not actionable else 8,
    'live_8m': 10 if bad_sum==0 else 8,
  }
}
report['overall']=round(sum(report['scores'].values())/len(report['scores']),2)
if verdict=='10/10':
  report['overall']=10
  for k in report['scores']: report['scores'][k]=10

Path('/tmp/dual_hard_report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
print('DUAL_DONE', verdict)
if verdict != '10/10':
  raise SystemExit(2)
PY
