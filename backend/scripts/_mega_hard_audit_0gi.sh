#!/bin/bash
# Mega hard audit 0gi — code wiring + live logs + DB NFT/accounts (JSON out)
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
OUT=/tmp/mega_audit_0gi.json
cd "$BASE/backend"
eval "$(python3 - <<'PY'
import re
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['OPENAI_API_KEY','PROXY_LIST','DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','DB_PORT','BOT_TOKEN','PORT']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    val=m.group(1).strip()
    if (val.startswith('"')and val.endswith('"'))or(val.startswith("'")and val.endswith("'")): val=val[1:-1]
    print("export %s='%s'"%(key,val.replace("'","'\"'\"'")))
PY
)"

node <<'NODE'
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const db = require('./db');

const ROOT = path.join(__dirname);
const FE = path.join(__dirname, '../frontend');
const report = {
  tag: '0gi',
  at: new Date().toISOString(),
  scores: {},
  checks: [],
  live: {},
  nft: {},
  accounts: {},
  visual: {},
  holes: [],
  strengths: [],
};

function add(area, name, ok, w, detail) {
  report.checks.push({ area, name, ok: !!ok, w, detail: String(detail || '').slice(0, 200) });
  if (!ok) report.holes.push(`[${area}] ${name}: ${detail || ''}`);
  else report.strengths.push(`[${area}] ${name}`);
}

function read(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch {
    return '';
  }
}

// --- PM2 / proxy ---
let pm2 = {};
try {
  const j = JSON.parse(execSync('pm2 jlist', { encoding: 'utf8' }));
  const p = j.find((x) => x.name === 'tgbot');
  const pl = (p?.pm2_env?.PROXY_LIST || '').split(';').filter(Boolean);
  pm2 = {
    status: p?.pm2_env?.status,
    proxy: pl.length,
    restarts: p?.pm2_env?.restart_time,
    uptimeMs: Date.now() - (p?.pm2_env?.pm_uptime || Date.now()),
  };
} catch (e) {
  pm2 = { err: e.message };
}
report.live.pm2 = pm2;
add('ops', 'tgbot online', pm2.status === 'online', 3, pm2.status);
add('ops', 'PROXY_LIST ≥5', (pm2.proxy || 0) >= 5, 3, `proxy=${pm2.proxy}`);

// --- Static wiring ---
const files = {
  jobFlip: read('services/jobFlipAsk.js'),
  nft: read('services/nftCampaign.js'),
  daily: read('services/dailyPhotos.js'),
  voice: read('services/voiceReplies.js'),
  hh: read('services/humanHardening.js'),
  ideas: read('services/humanIdeas10.js'),
  pipe: read('services/replyPipeline.js'),
  peers: read('services/peers.js'),
  how: read('services/howLong.js'),
  opsQ: read('services/opsQuality.js'),
  mem: read('services/memoryTriggers.js'),
  obj: read('services/objectionHandler.js'),
  server: read('server.js'),
};
add('nft', 'mayMentionFlipNft day1 gate', /mayMentionFlipNft/.test(files.jobFlip), 3, '');
add('nft', 'campaign ageHours < 24 off', /ageHours\s*<\s*24/.test(files.nft), 2, '');
add('nft', 'dailyPhotos too_early ≥24', /ageHours\s*<\s*24/.test(files.daily), 2, '');
add('nft', 'ticker shouldBlockNftPitchAsync', /shouldBlockNftPitchAsync/.test(files.nft), 2, '');
add('nft', 'voice repeat callout skip', /FLIP_VOICE_REPEAT_CALLOUT/.test(files.voice), 3, '');
add('nft', 'stripRepeatFlipPitch', /stripRepeatFlipPitch/.test(files.hh), 2, '');
add('nft', 'peer_nft_gates persist', /peer_nft_gates/.test(files.hh), 2, '');
add('human', 'humanIdeas10 present', /maybeLifeLagMs/.test(files.ideas), 2, '');
add('human', 'pipe life-lag', /maybeLifeLagMs/.test(files.pipe), 1, '');
add('human', 'pipe evening recall', /buildEveningRecallHint/.test(files.pipe), 1, '');
add('human', 'coffee combo strip', /stripCoffeeSeriesWalkCombo/.test(files.hh), 1, '');
add('human', 'self-told hobby', /type:\s*'hobby'/.test(files.mem), 1, '');
add('archive', 'howlong 21d', /HOWLONG_ARCHIVE_DAYS\s*=\s*21|ARCHIVE_DAYS\s*=\s*21|21/.test(files.how) && /markPeerFiltered|archivePeer/.test(files.how + files.pipe + files.obj), 2, '');
add('archive', 'isFolderFrozen', /isFolderFrozen/.test(files.peers), 2, '');
add('ops', 'opsQuality schedulers', /startOpsQualitySchedulers/.test(files.server), 2, '');
add('ops', 'silent reaction', /preferSilentReaction/.test(files.opsQ), 1, '');

// --- Frontend visual ---
let index = '';
let updates = '';
let styles = '';
let app = '';
try {
  index = fs.readFileSync(path.join(FE, 'index.html'), 'utf8');
  updates = fs.readFileSync(path.join(FE, 'updates.js'), 'utf8');
  styles = fs.readFileSync(path.join(FE, 'styles.css'), 'utf8');
  app = fs.readFileSync(path.join(FE, 'app.js'), 'utf8');
} catch (e) {
  report.visual.err = e.message;
}
const vMatch = index.match(/updates\.js\?v=(\d+)/);
report.visual = {
  updatesV: vMatch ? Number(vMatch[1]) : null,
  hasHumanEntry: /Живее как человек|Флип не в первый|Не путаем повтор/.test(updates),
  hasOperatorNote: /operator_note|отсев/.test(app + updates),
  cssSize: styles.length,
  appSize: app.length,
  darkTheme: /--bg|#0|background:\s*#1|#121|dark/i.test(styles.slice(0, 4000)),
};
add('visual', 'updates.js?v= present', !!vMatch && vMatch[1] >= 110, 2, `v=${vMatch && vMatch[1]}`);
add('visual', 'changelog human entry', report.visual.hasHumanEntry, 2, '');
add('visual', 'styles.css non-empty', styles.length > 5000, 1, `len=${styles.length}`);
add('visual', 'app.js funnel/отсев hooks', /отсев|filtered|operator_note|lead/i.test(app), 2, '');

// --- Live logs ---
function grepLog(pat, files, max = 40) {
  const hits = [];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    try {
      const out = execSync(`grep -aE '${pat}' '${f}' | tail -${max}`, {
        encoding: 'utf8',
        maxBuffer: 5e6,
      });
      hits.push(...out.split('\n').filter(Boolean));
    } catch (_) {
      /* no matches = exit 1 */
    }
  }
  return hits;
}
const logFiles = [
  '/root/.pm2/logs/tgbot-out.log',
  '/root/.pm2/logs/tgbot-out__2026-10-31_00-00-00.log',
  '/root/.pm2/logs/tgbot-error.log',
];
const errHits = grepLog('FROZEN_METHOD|PEER_ID_INVALID|REFUSE_PROXY|OpenAIError|ECONNREFUSED', [
  '/root/.pm2/logs/tgbot-error.log',
], 30);
const flipVoice = grepLog('flipping\\.ogg', logFiles, 30);
const calloutFlip = grepLog('первый день еще говор|первый день ещё говор', logFiles, 20);
const day1Job = grepLog('я занимаюсь флипингом|флипаю токены онлайн', [
  '/root/.pm2/logs/tgbot-out.log',
], 40);
const archiveHits = grepLog('отсев \\+ архив|HOWLONG|markPeerFiltered|архив', logFiles, 20);
const outbound = grepLog('outbound voice|Ответ для', ['/root/.pm2/logs/tgbot-out.log'], 50);
const aiSilent = grepLog('AI замолчал|OpenAI не', logFiles, 15);

report.live.errHits = errHits.length;
report.live.flipVoiceRecent = flipVoice.length;
report.live.calloutSeen = calloutFlip.length;
report.live.day1FlipPhrases = day1Job.length;
report.live.archiveHits = archiveHits.length;
report.live.outboundSample = outbound.length;
report.live.aiSilent = aiSilent.length;
report.live.errSample = errHits.slice(-5);
report.live.flipVoiceSample = flipVoice.slice(-3);

add('live', 'no REFUSE_PROXY flood', !errHits.some((l) => /REFUSE_PROXY/.test(l)), 2, '');
add('live', 'outbound alive', outbound.length > 5, 2, `n=${outbound.length}`);
add(
  'live',
  'FROZEN noise contained',
  errHits.filter((l) => /FROZEN/.test(l)).length < 15,
  1,
  `frozenLines=${errHits.filter((l) => /FROZEN/.test(l)).length}`,
);

(async () => {
  // DB NFT / accounts
  try {
    const [accs] = await db.query(
      `SELECT COUNT(*) n, SUM(status='active' OR status=1 OR is_active=1) activeish
       FROM accounts`,
    ).catch(async () => {
      const [cols] = await db.query(`SHOW COLUMNS FROM accounts`);
      report.accounts.columns = cols.map((c) => c.Field);
      const [a2] = await db.query(`SELECT COUNT(*) n FROM accounts`);
      return [a2];
    });
    report.accounts.count = accs[0];

    const [gates] = await db.query(`SELECT COUNT(*) n, SUM(interest_hits>=2) warm FROM peer_nft_gates`);
    report.nft.gates = gates[0];

    const [flipMsgs] = await db.query(
      `SELECT COUNT(*) n FROM conversation_messages
       WHERE role='assistant' AND created_at > (NOW() - INTERVAL 24 HOUR)
         AND (content LIKE '%флип%' OR content LIKE '%NFT%' OR content LIKE '%токен%' OR content LIKE '%профит%')`,
    );
    report.nft.flipMsgs24h = flipMsgs[0].n;

    const [profit] = await db.query(
      `SELECT COUNT(*) n FROM conversation_messages
       WHERE role='assistant' AND created_at > (NOW() - INTERVAL 48 HOUR)
         AND (content LIKE '%профит%' OR content LIKE '%скринышот прибыли%' OR content LIKE '%скринышот%' OR content LIKE '%флиппинга NFT%')`,
    ).catch(() => [[{ n: 0 }]]);
    report.nft.profitMsgs48h = profit[0].n;

    const [photos] = await db.query(
      `SELECT COUNT(*) n FROM conversation_messages
       WHERE role='assistant' AND created_at > (NOW() - INTERVAL 48 HOUR)
         AND content LIKE '%[фото от меня:%'`,
    );
    report.nft.photos48h = photos[0].n;

    // early flip: first assistant flip within 2h of first message in peer
    const [early] = await db.query(
      `SELECT COUNT(*) n FROM (
         SELECT cm.account_id, cm.peer_id,
           MIN(CASE WHEN cm.role='user' THEN cm.created_at END) first_user,
           MIN(CASE WHEN cm.role='assistant' AND (cm.content LIKE '%флип%' OR cm.content LIKE '%токен%') THEN cm.created_at END) first_flip
         FROM conversation_messages cm
         WHERE cm.created_at > (NOW() - INTERVAL 7 DAY)
         GROUP BY cm.account_id, cm.peer_id
         HAVING first_flip IS NOT NULL AND first_user IS NOT NULL
            AND TIMESTAMPDIFF(HOUR, first_user, first_flip) < 2
       ) t`,
    );
    report.nft.earlyFlipPeers7d = early[0].n;
    add('nft', 'early flip peers 7d low', early[0].n <= 25, 3, `early=${early[0].n}`);
    add('nft', 'gates table alive', Number(gates[0].n) >= 0, 1, JSON.stringify(gates[0]));
    add('accounts', 'accounts table', Number(accs[0].n) > 0, 2, JSON.stringify(accs[0]));
  } catch (e) {
    report.nft.dbErr = e.message;
    add('nft', 'db probe', false, 2, e.message);
  }

  // score
  const byArea = {};
  for (const c of report.checks) {
    if (!byArea[c.area]) byArea[c.area] = { got: 0, max: 0, fail: 0 };
    byArea[c.area].max += c.w;
    if (c.ok) byArea[c.area].got += c.w;
    else byArea[c.area].fail += 1;
  }
  let got = 0;
  let max = 0;
  for (const a of Object.keys(byArea)) {
    got += byArea[a].got;
    max += byArea[a].max;
    byArea[a].score10 = max ? Math.round((byArea[a].got / byArea[a].max) * 100) / 10 : 0;
  }
  const total10 = max ? Math.round((got / max) * 100) / 10 : 0;
  report.scores = { byArea, got, max, total10 };
  report.verdict =
    total10 >= 9.5
      ? '10/10 production-ready (minor noise ok)'
      : total10 >= 8.5
        ? 'strong — fix listed holes'
        : 'not ready';

  fs.writeFileSync('/tmp/mega_audit_0gi.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ total10, byArea, holes: report.holes, nft: report.nft, live: report.live, visual: report.visual, pm2 }, null, 2));
  console.log('MEGA_AUDIT_0GI_OK');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
NODE
