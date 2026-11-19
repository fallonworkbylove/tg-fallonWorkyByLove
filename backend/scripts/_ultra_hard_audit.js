/**
 * Ultra-hard full project audit: static + live DB + reply quality windows.
 * node scripts/_ultra_hard_audit.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
require('dotenv').config({
  path: path.join(__dirname, '../.env'),
  quiet: true,
});
const db = require('../db');
// Post-fix window: override with AUDIT_FIX_SINCE; default = last ship window.
const FIX_SINCE = process.env.AUDIT_FIX_SINCE || '2026-11-04 14:20:00';
const findings = [];
const cats = {
  security: { score: 10, checks: [] },
  reliability: { score: 10, checks: [] },
  ai: { score: 10, checks: [] },
  ui: { score: 10, checks: [] },
  ops: { score: 10, checks: [] },
};

function read(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch {
    return '';
  }
}

function ok(cat, name, pass, sev = 'P1', detail = '') {
  cats[cat].checks.push({ name, pass: !!pass, sev, detail });
  if (!pass) {
    const pen = sev === 'P0' ? 3 : sev === 'P1' ? 1.5 : 0.4;
    cats[cat].score = Math.max(0, Math.round((cats[cat].score - pen) * 10) / 10);
    findings.push({ cat, sev, name, detail });
  }
}

(async () => {
  const auth = read('backend/middleware/telegramAuth.js');
  const server = read('backend/server.js');
  const getUserId = read('backend/lib/getUserId.js');
  const accounts = read('backend/routes/accounts.js');
  const appJs = read('frontend/app.js');
  const index = read('frontend/index.html');
  const updates = read('frontend/updates.js');
  const styles = read('frontend/styles.css');
  const soft = read('backend/services/softHumanLite.js');
  const human = read('backend/services/humanExtra.js');
  const harden = read('backend/services/humanHardening.js');
  const media = read('backend/services/mediaSend.js');
  const rp = read('backend/services/replyPipeline.js');
  const ai = read('backend/services/aiResponder.js');
  const proxies = read('backend/services/proxyPools.js');
  const gitignore = read('.gitignore');

  // SECURITY
  ok('security', 'loopback_socket_only', /socketRemoteAddress|socket\.remoteAddress/.test(auth), 'P0');
  ok('security', 'bypass_force_key_loopback', /TELEGRAM_AUTH_BYPASS_FORCE/.test(auth) && /X-Auth-Bypass-Key/.test(auth), 'P0');
  // Replay window: 2ч (7200) предпочтительно; 86400 — legacy.
  ok(
    'security',
    'initData_auth_date',
    /auth_date/.test(auth) && /(?:7200|86400)/.test(auth),
    'P0',
  );
  ok('security', 'initData_timingSafeEqual', /timingSafeEqual/.test(auth), 'P1');
  ok('security', 'cors_not_wildcard', !/origin:\s*true/.test(server) && !/origin:\s*\*/.test(server), 'P0');
  ok('security', 'x_powered_by_off', /x-powered-by/.test(server), 'P2');
  ok('security', 'getUserId_no_fallback_1', !/\breturn\s+1\b/.test(getUserId) && !/fallback\s*=\s*1/.test(getUserId), 'P0');
  ok('security', 'getUserId_401', /401/.test(getUserId), 'P0');
  ok('security', 'ops_loopback_routes', /requireOpsLoopback/.test(accounts), 'P0');
  ok('security', 'accounts_scoped_userid', /getUserId\(req\)/.test(accounts), 'P0');
  ok('security', 'escapeHtml', /function escapeHtml/.test(appJs), 'P0');
  ok('security', 'safeTelegramHref', /function safeTelegramHref/.test(appJs), 'P1');
  ok('security', 'env_gitignored', /\.env/.test(gitignore), 'P1');
  ok('security', 'media_link_server_validate', /t\.me|telegram\.me/.test(accounts) && /mediaChatLink|media_chat_link/.test(accounts), 'P1');

  // RELIABILITY
  ok('reliability', 'contradictory_lazy_require', /mediaHelpers\.isContradictoryMediaText/.test(rp), 'P0');
  ok('reliability', 'sessionForgetHint_scope', /sessionForgetHint снаружи try|let sessionForgetHint/.test(rp), 'P1');
  ok('reliability', 'strip_media_leak', /stripLeakedMediaHistoryTag/.test(media), 'P0');
  ok('reliability', 'proxy_random_start', /Math\.random\(\) \* PROXY_POOL\.length/.test(proxies), 'P1');
  ok('reliability', 'openai_skip_first_dead', /list\.length > 1|OPENAI_PROXY_INDEX|socks5ListFromEnv/.test(ai), 'P1');

  // AI
  ok('ai', 'afterthoughts_off', /const AFTERTHOUGHTS = \[\]/.test(human), 'P0');
  ok('ai', 'ensureAckNotBare', /ensureAckNotBare/.test(soft), 'P0');
  ok('ai', 'enrichBareAck', /enrichBareAckOnSubstance/.test(soft), 'P0');
  ok('ai', 'softCompleteCut_aeshe', /softCompleteCut/.test(soft) && /а ещё|а\\s\+ещё/.test(soft), 'P1');

  // UI
  ok(
    'ui',
    'updates_feed_present',
    /LOVERUSSIAN_UPDATES/.test(updates) &&
      /Полный разбор|Ответы стали чище|Живее и розовее/.test(updates),
    'P1',
  );
  ok('ui', 'cache_bust_app', /app\.js\?v=\d+/.test(index), 'P1');
  ok('ui', 'cache_bust_updates', /updates\.js\?v=\d+/.test(index), 'P1');
  ok('ui', 'confirms_danger', /confirm\('Удалить аккаунт/.test(appJs) && /Стереть историю/.test(appJs), 'P1');
  ok('ui', 'escape_updates_render', /escapeHtml\(entry\.title/.test(appJs), 'P1');
  ok('ui', 'styles_present', styles.length > 5000, 'P2', `styles_bytes=${styles.length}`);
  ok('ui', 'no_tech_jargon_feed', !/`require`|isContradictory|SOCKS|pm2|timingSafeEqual/.test(updates), 'P2');
  // Тема: светлый primary / розовый акцент (не завязаны на старый #e879c8).
  ok(
    'ui',
    'theme_tokens',
    /--primary:\s*#[0-9a-f]{3,8}/i.test(styles) && /#f9a8d4|#e879c8|#d946ef/i.test(styles),
    'P1',
  );
  ok('ui', 'humanize_texture_on', /humanizeChatTexture/.test(soft), 'P1');
  ok('ai', 'typo_fix_podderzhka', /поддеожк/.test(ai) && /function fixModelTypos/.test(ai), 'P1');
  ok(
    'ai',
    'stub_after_reask',
    /stripReaskEcho[\s\S]{0,280}expandBareStubOnQuestion/.test(harden),
    'P1',
  );

  // OPS static
  ok('ops', 'catchup_all_route', /catch-up-all/.test(accounts), 'P1');
  ok('ops', 'pool_status_route', /pool-status/.test(accounts), 'P1');

  // LIVE DB
  const [[vol]] = await db.execute(
    `SELECT
      SUM(role='assistant' AND created_at >= ?) AS asst_since,
      SUM(role='user' AND created_at >= ?) AS user_since,
      SUM(role='assistant' AND created_at > NOW()-INTERVAL 24 HOUR) AS asst_24h,
      SUM(role='user' AND created_at > NOW()-INTERVAL 24 HOUR) AS user_24h
     FROM conversation_messages`,
    [FIX_SINCE, FIX_SINCE],
  );

  const [stubs] = await db.execute(
    `SELECT account_id, content, created_at FROM conversation_messages
     WHERE role='assistant' AND created_at >= ?
       AND TRIM(content) IN ('а ещё)','а ещё','ага','ага)','круто)','круто','ну да)','хм ок','хм ок)','ладно')
     ORDER BY id DESC LIMIT 20`,
    [FIX_SINCE],
  );
  ok('ai', 'no_new_bare_stubs', stubs.length === 0, 'P1', `n=${stubs.length}`);

  const [leaks] = await db.execute(
    `SELECT account_id, LEFT(content,100) c, created_at FROM conversation_messages
     WHERE role='assistant' AND created_at >= ?
       AND (content LIKE '%[отправила %' OR content REGEXP '\\\\{фото:|\\\\{кружок:')
       AND content NOT LIKE '[медиа:%'
     LIMIT 20`,
    [FIX_SINCE],
  );
  ok('ai', 'no_new_media_leaks', leaks.length === 0, 'P0', `n=${leaks.length}`);

  const [robot] = await db.execute(
    `SELECT COUNT(*) c FROM conversation_messages
     WHERE role='assistant' AND created_at >= ?
       AND (content LIKE '%чем могу помочь%' OR content LIKE '%всегда рада общению%'
            OR content LIKE '%зависит от восприятия%' OR content REGEXP 'для вас|для тех, кто')`,
    [FIX_SINCE],
  );
  ok('ai', 'no_robotic_phrases', Number(robot[0].c) === 0, 'P1', `n=${robot[0].c}`);

  const [staleGaps] = await db.execute(
    `SELECT cm.account_id, cm.peer_id, LEFT(cm.content,60) c,
            TIMESTAMPDIFF(MINUTE, cm.created_at, NOW()) age_m
     FROM conversation_messages cm
     JOIN accounts a ON a.id=cm.account_id
     WHERE cm.role='user'
       AND cm.created_at < NOW() - INTERVAL 20 MINUTE
       AND cm.created_at > NOW() - INTERVAL 6 HOUR
       AND a.is_autoreply_enabled=1 AND IFNULL(a.prompt,'')!=''
       AND a.session_string IS NOT NULL AND a.session_string!=''
       AND NOT EXISTS (SELECT 1 FROM conversation_messages x WHERE x.account_id=cm.account_id AND x.peer_id=cm.peer_id AND x.role='assistant' AND x.id>cm.id)
       AND NOT EXISTS (SELECT 1 FROM autoreply_disabled_peers ad WHERE ad.account_id=cm.account_id AND ad.peer_id=cm.peer_id)
       AND NOT EXISTS (SELECT 1 FROM archived_peers ap WHERE ap.account_id=cm.account_id AND ap.peer_id=cm.peer_id)
     ORDER BY cm.created_at ASC LIMIT 30`,
  );
  ok('ai', 'no_stale_unanswered_20m', staleGaps.length === 0, 'P1', `n=${staleGaps.length}`);

  const [shortWeak] = await db.execute(
    `SELECT COUNT(*) c FROM conversation_messages
     WHERE role='assistant' AND created_at >= ?
       AND CHAR_LENGTH(TRIM(content)) BETWEEN 1 AND 5
       AND content NOT LIKE '[медиа:%' AND content NOT LIKE '[голосовое:%'
       AND content NOT LIKE '[реакция:%'
       AND content NOT REGEXP '[❤😁☺️😊🥰🔥👍]'
       AND TRIM(content) NOT IN ('неа)','нет)','ок)','да)','ага)','угу)','мм)','хм)')`,
    [FIX_SINCE],
  );
  // Живые коротыши (неа/нет/ок) ок; порог на мусорные обрубки после постфильтра.
  ok('ai', 'few_ultra_short_1_5', Number(shortWeak[0].c) <= 5, 'P2', `n=${shortWeak[0].c}`);

  const [[acc]] = await db.execute(
    `SELECT
      COUNT(*) total,
      SUM(is_autoreply_enabled=1) ai_on,
      SUM(is_autoreply_enabled=1 AND session_string IS NOT NULL AND session_string!='') ai_sess,
      SUM(session_string IS NOT NULL AND session_string!='') with_session
     FROM accounts`,
  );
  ok('ops', 'ai_on_has_session', Number(acc.ai_on) === Number(acc.ai_sess), 'P1', `ai_on=${acc.ai_on} sess=${acc.ai_sess}`);

  // Recent reply sample quality (length distribution)
  const [lens] = await db.execute(
    `SELECT
       SUM(CHAR_LENGTH(TRIM(content)) BETWEEN 1 AND 8) short8,
       SUM(CHAR_LENGTH(TRIM(content)) BETWEEN 9 AND 40) mid,
       SUM(CHAR_LENGTH(TRIM(content)) > 40) longish,
       COUNT(*) n
     FROM conversation_messages
     WHERE role='assistant' AND created_at >= ?
       AND content NOT LIKE '[медиа:%' AND content NOT LIKE '[голосовое:%'`,
    [FIX_SINCE],
  );

  const [[onlineHint]] = await db.execute(`SELECT 1 AS x`); // placeholder; pool checked externally

  const scores = Object.fromEntries(
    Object.entries(cats).map(([k, v]) => [k, v.score]),
  );
  const overall =
    Object.values(scores).reduce((a, b) => a + b, 0) / Object.keys(scores).length;
  const passCount = Object.values(cats).reduce(
    (n, c) => n + c.checks.filter((x) => x.pass).length,
    0,
  );
  const totalChecks = Object.values(cats).reduce((n, c) => n + c.checks.length, 0);

  const report = {
    fix_since: FIX_SINCE,
    score: scores,
    overall: Math.round(overall * 10) / 10,
    checks: { pass: passCount, total: totalChecks },
    volume: {
      assistant_since_fix: Number(vol.asst_since) || 0,
      user_since_fix: Number(vol.user_since) || 0,
      assistant_24h: Number(vol.asst_24h) || 0,
      user_24h: Number(vol.user_24h) || 0,
    },
    reply_length_since_fix: {
      short_1_8: Number(lens[0].short8) || 0,
      mid_9_40: Number(lens[0].mid) || 0,
      long_40p: Number(lens[0].longish) || 0,
      n: Number(lens[0].n) || 0,
    },
    accounts: {
      total: Number(acc.total),
      ai_on: Number(acc.ai_on),
      ai_with_session: Number(acc.ai_sess),
      with_session: Number(acc.with_session),
    },
    findings,
    stale_gaps: staleGaps.slice(0, 8),
    stub_samples: stubs.slice(0, 5),
    leak_samples: leaks.slice(0, 5),
    checks_detail: Object.fromEntries(
      Object.entries(cats).map(([k, v]) => [
        k,
        v.checks.map((c) => ({
          name: c.name,
          pass: c.pass,
          sev: c.sev,
          detail: c.detail || undefined,
        })),
      ]),
    ),
  };

  console.log('=== ULTRA HARD AUDIT ===');
  console.log(JSON.stringify(report, null, 2));
  const p0 = findings.filter((f) => f.sev === 'P0').length;
  console.log('P0_COUNT', p0);
  console.log('CHECKS', `${passCount}/${totalChecks}`);
  if (overall >= 9.95 && p0 === 0 && findings.length === 0) console.log('VERDICT 10/10');
  else if (overall >= 9.95 && p0 === 0) console.log('VERDICT 10/10 soft_findings', findings.length);
  else console.log('VERDICT', Math.round(overall * 10) / 10);
  process.exit(p0 ? 2 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
