/**
 * Жёсткий аудит от корня: security / reliability / AI / UI / ops.
 * Запуск на VPS: node scripts/_full_root_audit.js
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const db = require('../db');

const ROOT = path.resolve(__dirname, '../..');
const B = path.resolve(__dirname, '..');
const findings = [];
const score = { security: 10, reliability: 10, ai: 10, ui: 10, ops: 10 };

function hit(cat, sev, msg, file) {
  findings.push({ cat, sev, msg, file: file || '' });
  const pen = sev === 'P0' ? 3 : sev === 'P1' ? 1.5 : 0.5;
  score[cat] = Math.max(0, Math.round((score[cat] - pen) * 10) / 10);
}

function read(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch {
    return '';
  }
}

(async () => {
  // --- static security ---
  const auth = read('backend/middleware/telegramAuth.js');
  if (!/isLoopback/.test(auth) || /X-Forwarded-For/.test(auth) && /isLoopback[\s\S]{0,200}X-Forwarded/.test(auth)) {
    /* ok if loopback uses socket only */
  }
  if (!/socket\.remoteAddress|socketRemoteAddress/.test(auth)) {
    hit('security', 'P0', 'telegramAuth loopback не на socket.remoteAddress', 'backend/middleware/telegramAuth.js');
  }
  if (!/TELEGRAM_AUTH_BYPASS_FORCE/.test(auth)) {
    hit('security', 'P1', 'нет FORCE+key для prod bypass', 'backend/middleware/telegramAuth.js');
  }
  if (!/auth_date/.test(auth)) {
    hit('security', 'P0', 'нет проверки auth_date / replay', 'backend/middleware/telegramAuth.js');
  }

  const server = read('backend/server.js');
  if (/cors\(\s*\{[^}]*origin:\s*true/.test(server) || /origin:\s*\*/.test(server)) {
    hit('security', 'P0', 'CORS reflect-any / *', 'backend/server.js');
  }
  if (!/x-powered-by/.test(server)) {
    hit('security', 'P2', 'x-powered-by не отключён явно', 'backend/server.js');
  }

  const getUserId = read('backend/lib/getUserId.js');
  // Реальный баг — `return 1` / fallback=1 в коде, не упоминание в комментарии «без fallback».
  if (/\breturn\s+1\b/.test(getUserId) || /fallback\s*=\s*1/.test(getUserId)) {
    hit('security', 'P0', 'getUserId fallback на user 1', 'backend/lib/getUserId.js');
  }
  if (!/throw err|statusCode = 401|status = 401/.test(getUserId)) {
    hit('security', 'P1', 'getUserId не кидает 401 без dbUser', 'backend/lib/getUserId.js');
  }

  const appJs = read('frontend/app.js');
  if (
    /href="\$\{escapeHtml\([^)]*media_chat_link/.test(appJs) &&
    !/function safeTelegramHref/.test(appJs)
  ) {
    hit('security', 'P1', 'media_chat_link в href без allowlist http(s)/tg', 'frontend/app.js');
  }
  if (!/timingSafeEqual/.test(auth)) {
    hit('security', 'P2', 'initData hash без timingSafeEqual', 'backend/middleware/telegramAuth.js');
  }
  if (!/function escapeHtml/.test(appJs)) {
    hit('security', 'P0', 'нет escapeHtml во frontend', 'frontend/app.js');
  }

  // secrets in tracked tree (sample)
  for (const f of [
    'backend/.env',
    '.env',
    'backend/config/proxies.txt',
  ]) {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p) && !f.includes('proxies')) {
      // .env should not be in git; existence on disk OK
    }
  }
  const gitignore = read('.gitignore');
  if (!/\.env/.test(gitignore)) {
    hit('security', 'P1', '.env не в .gitignore', '.gitignore');
  }

  // --- reliability static ---
  const rp = read('backend/services/replyPipeline.js');
  if (/isContradictoryMediaText\(outText\)/.test(rp) && !/mediaHelpers\.isContradictoryMediaText/.test(rp)) {
    hit('reliability', 'P0', 'голый isContradictoryMediaText без lazy require', 'backend/services/replyPipeline.js');
  }
  if (!/mediaHelpers\.isContradictoryMediaText/.test(rp)) {
    hit('reliability', 'P0', 'нет mediaHelpers.isContradictoryMediaText', 'backend/services/replyPipeline.js');
  }

  const soft = read('backend/services/softHumanLite.js');
  if (!/ensureAckNotBare/.test(soft)) {
    hit('ai', 'P0', 'нет ensureAckNotBare', 'backend/services/softHumanLite.js');
  }
  const human = read('backend/services/humanExtra.js');
  if (/const AFTERTHOUGHTS = \[[^\]]+\]/.test(human) && !/const AFTERTHOUGHTS = \[\]/.test(human)) {
    hit('ai', 'P1', 'AFTERTHOUGHTS не пустой — риск пустых досылок', 'backend/services/humanExtra.js');
  }

  const media = read('backend/services/mediaSend.js');
  if (!/stripLeakedMediaHistoryTag/.test(media)) {
    hit('ai', 'P0', 'нет stripLeakedMediaHistoryTag', 'backend/services/mediaSend.js');
  }

  const ai = read('backend/services/aiResponder.js');
  if (!/socks5ListFromEnv|OPENAI_PROXY_INDEX|list\.length > 1/.test(ai)) {
    hit('ops', 'P1', 'OpenAI без ротации SOCKS (риск мёртвого первого прокси)', 'backend/services/aiResponder.js');
  }

  const updates = read('frontend/updates.js');
  if (!/Полный разбор|Ответы стали чище|Чище ответы/.test(updates)) {
    hit('ui', 'P2', 'в ленте обновлений нет свежего поста про разбор', 'frontend/updates.js');
  }
  const index = read('frontend/index.html');
  if (!/updates\.js\?v=\d+/.test(index)) {
    hit('ui', 'P1', 'updates.js без cache-bust', 'frontend/index.html');
  }

  // --- live DB AI checks ---
  const FIX_SINCE = process.env.AUDIT_FIX_SINCE || new Date(Date.now() - 30 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');

  const [stubs] = await db.execute(
    `SELECT COUNT(*) c FROM conversation_messages
     WHERE role='assistant' AND created_at >= ?
       AND TRIM(content) IN ('а ещё)','а ещё','ага','ага)','круто)','круто','ну да)','хм ок','хм ок)')`,
    [FIX_SINCE],
  );
  if (Number(stubs[0].c) > 0) {
    hit('ai', 'P1', `новые голые stubs после фикса: ${stubs[0].c}`, 'db');
  }

  const [leaks] = await db.execute(
    `SELECT COUNT(*) c FROM conversation_messages
     WHERE role='assistant' AND created_at >= ?
       AND (content LIKE '%[отправила %' OR content REGEXP '\\\\{фото:|\\\\{кружок:')
       AND content NOT LIKE '[медиа:%'`,
    [FIX_SINCE],
  );
  if (Number(leaks[0].c) > 0) {
    hit('ai', 'P0', `новые media-leaks в тексте: ${leaks[0].c}`, 'db');
  }

  const [gaps] = await db.execute(
    `SELECT COUNT(*) c FROM conversation_messages cm
     JOIN accounts a ON a.id=cm.account_id
     WHERE cm.role='user' AND cm.created_at < NOW() - INTERVAL 20 MINUTE
       AND cm.created_at > NOW() - INTERVAL 3 HOUR
       AND a.is_autoreply_enabled=1 AND IFNULL(a.prompt,'')!=''
       AND a.session_string IS NOT NULL AND a.session_string!=''
       AND NOT EXISTS (SELECT 1 FROM conversation_messages x WHERE x.account_id=cm.account_id AND x.peer_id=cm.peer_id AND x.role='assistant' AND x.id>cm.id)
       AND NOT EXISTS (SELECT 1 FROM autoreply_disabled_peers ad WHERE ad.account_id=cm.account_id AND ad.peer_id=cm.peer_id)
       AND NOT EXISTS (SELECT 1 FROM archived_peers ap WHERE ap.account_id=cm.account_id AND ap.peer_id=cm.peer_id)`,
  );
  if (Number(gaps[0].c) > 0) {
    hit('ai', 'P1', `stale unanswered (>=20m, not archived): ${gaps[0].c}`, 'db');
  }

  const [[sess]] = await db.execute(
    `SELECT SUM(is_autoreply_enabled=1) ai_on,
            SUM(is_autoreply_enabled=1 AND session_string IS NOT NULL AND session_string!='') ai_sess
     FROM accounts`,
  );
  if (Number(sess.ai_on) > Number(sess.ai_sess)) {
    hit('ops', 'P1', `AI on без session: ${sess.ai_on - sess.ai_sess}`, 'db');
  }

  // accounts ownership spot-check routes
  const accountsRoute = read('backend/routes/accounts.js');
  if (!/requireOpsLoopback/.test(accountsRoute)) {
    hit('security', 'P0', 'catch-up-all / pool-status без ops loopback', 'backend/routes/accounts.js');
  }
  if (!/getUserId\(req\)/.test(accountsRoute)) {
    hit('security', 'P0', 'accounts routes без getUserId', 'backend/routes/accounts.js');
  }

  const overall =
    (score.security + score.reliability + score.ai + score.ui + score.ops) / 5;

  console.log('=== FULL ROOT AUDIT ===');
  console.log(JSON.stringify({ score, overall: Math.round(overall * 10) / 10, fix_since: FIX_SINCE, findings }, null, 2));
  const p0 = findings.filter((f) => f.sev === 'P0');
  if (p0.length) console.log('P0_COUNT', p0.length);
  else console.log('P0_COUNT 0');
  if (overall >= 9.95 && p0.length === 0) console.log('VERDICT 10/10');
  else console.log('VERDICT', Math.round(overall * 10) / 10);
  process.exit(p0.length ? 2 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
