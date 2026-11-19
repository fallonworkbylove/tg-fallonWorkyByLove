require('dotenv').config();

// AUDIT_SMOKE из CLI-смоков не должен жить в pm2 env: иначе openai=null
// и ответы падают с "Cannot read properties of null (reading 'chat')".
if (process.env.pm_id != null || String(process.env.name || '') === 'tgbot') {
  delete process.env.AUDIT_SMOKE;
}

// Буфер логов OPS — до остального, чтобы ловить boot-сообщения.
require('./services/adminLogBuffer').install();

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS: явный список CORS_ORIGIN. Без env — только same-origin (не reflect-any).
const corsOriginRaw = String(process.env.CORS_ORIGIN || '').trim();
// «*» в env — не wildcard: в production с credentials нельзя; трактуем как «не задано».
const corsOriginList = corsOriginRaw
  ? corsOriginRaw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && s !== '*')
  : [];
const isProd =
  !['development', 'dev', 'test'].includes(
    String(process.env.NODE_ENV || 'production').toLowerCase(),
  );
if (isProd && corsOriginList.length === 0) {
  console.warn(
    '[cors] CORS_ORIGIN не задан в production — браузерные cross-origin запросы отклоняются.',
  );
}
app.use(
  cors({
    origin: corsOriginList.length
      ? corsOriginList
      : (origin, cb) => {
          // Нет Origin (curl / same-origin) — ок; чужой Origin — отказ.
          if (!origin) return cb(null, true);
          return cb(null, false);
        },
    credentials: true,
  }),
);
app.use(express.json({ limit: '1mb' }));
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  );
  const xfProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (xfProto === 'https' || req.secure) {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=15552000; includeSubDomains',
    );
  }
  next();
});

app.use(require('./middleware/httpRateLimit'));

// Telegram WebApp initData verification middleware
const telegramAuth = require('./middleware/telegramAuth');
app.use(telegramAuth);

// Debug middleware: logs req.user and adds X-Debug-User header (dev only)
const debugUser = require('./middleware/debugUser');
app.use(debugUser);

// Routes
app.use('/api/accounts', require('./routes/accounts'));
app.use("/api/dashboard", require("./routes/dashboard"));
app.use("/api/options", require("./routes/options"));
app.use("/api/blacklist", require("./routes/blacklist"));
app.use("/api/photo-exceptions", require("./routes/photoExceptions"));
app.use("/api/examples", require("./routes/examples"));
app.use("/api/stats", require("./routes/stats"));
app.use("/api/admin/console", require("./routes/adminConsole"));

// Базовая проверка. Детали пула — только socket-loopback (без XFF).
// Deploy guard читает openai_ready / proxy_len / audit_smoke после pm2 restart.
app.get('/api/health', async (req, res) => {
  try {
    let openaiReady = false;
    let proxyLen = 0;
    try {
      const ai = require('./services/aiResponder');
      if (typeof ai.isOpenAiClientReady === 'function') {
        openaiReady = Boolean(ai.isOpenAiClientReady());
      }
      if (typeof ai.openAiProxyPoolLen === 'function') {
        proxyLen = Number(ai.openAiProxyPoolLen()) || 0;
      }
    } catch (_) {
      openaiReady = false;
    }
    if (!proxyLen) {
      const raw = String(process.env.OPENAI_PROXY_LIST || process.env.PROXY_LIST || '');
      proxyLen = raw.split(';').filter((x) => /socks5?/i.test(x.trim())).length;
    }
    const body = {
      status: 'ok',
      uptime_s: Math.round(process.uptime()),
      ts: Date.now(),
      openai_ready: openaiReady,
      proxy_len: proxyLen,
      audit_smoke: process.env.AUDIT_SMOKE === '1',
    };
    try {
      const { isLoopback } = require('./middleware/telegramAuth');
      if (isLoopback(req)) {
        const { isActive } = require('./services/telegramClient');
        const db = require('./db');
        const [rows] = await db.execute(
          `SELECT id FROM accounts WHERE session_string IS NOT NULL AND session_string != ''`,
        );
        body.sessions = {
          online: rows.filter((r) => isActive(r.id)).length,
          total: rows.length,
        };
      }
    } catch (_) {
      /* ignore enrichment errors */
    }
    res.json(body);
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});
const { bootstrapSessions } = require('./services/sessionBootstrap');
const { ensureSchema: ensurePhotoExceptionsSchema } = require('./services/photoRecognitionSettings');
const { ensureAccountSeqSchema } = require('./services/accountCleanup');
const { startDailyPhotoScheduler } = require('./services/dailyPhotos');
const { startNotificationBot } = require('./services/helpRequestNotifier');
const { startSilenceScheduler } = require('./services/objectionHandler');

// Прод: только localhost (nginx → 127.0.0.1:3000). Иначе LISTEN_HOST=0.0.0.0.
const listenHost = String(
  process.env.LISTEN_HOST || (isProd ? '127.0.0.1' : '0.0.0.0'),
).trim() || '127.0.0.1';
app.listen(PORT, listenHost, () => {
  console.log(`Server is running on ${listenHost}:${PORT}`);
  ensurePhotoExceptionsSchema().catch((err) =>
    console.error('Не удалось создать таблицу photo_recognition_disabled_chats:', err.message),
  );
  ensureAccountSeqSchema().catch((err) =>
    console.error('Не удалось инициализировать accounts.seq:', err.message),
  );
  (async () => {
    try {
      const { warmProbeWorkProxies } = require('./services/proxyPools');
      await warmProbeWorkProxies({ timeoutMs: 10000, concurrency: 3 });
    } catch (err) {
      console.warn('[proxy] warm probe:', err.message);
    }
    try {
      await bootstrapSessions();
    } catch (err) {
      console.error('bootstrapSessions:', err.message);
    }
  })();
  startDailyPhotoScheduler();
  startNotificationBot();

  // Дайджест отсева + алерт «AI замолчал».
  try {
    require('./services/opsQuality').startOpsQualitySchedulers();
  } catch (err) {
    console.error('[opsQuality] start:', err.message);
  }

  // Напоминание «привет, чё молчиш)» при 2-3 днях молчания собеседника.
  // Зависимости берутся из telegramClient.js лениво (require внутри), чтобы
  // избежать циклической загрузки модулей при старте сервера.
  const {
    getAccountSettings,
    isWithinWorkingHours,
    isVoiceQuietHour,
    saveMessage,
  } = require('./services/telegramClient');
  const { isAutoreplyDisabledForPeer } = require('./services/helpRequestNotifier');
  startSilenceScheduler({
    getAccountSettings,
    isWithinWorkingHours,
    isVoiceQuietHour,
    isAutoreplyDisabledForPeer,
    saveMessage,
  });

  // Таблица churn + обучение на удаливших/блоках (без остановки AI).
  try {
    require('./services/churnLearn').ensureTables().catch((err) =>
      console.error('[churnLearn] ensureTables:', err.message),
    );
  } catch (err) {
    console.error('[churnLearn] load:', err.message);
  }
});

/** pm2 stop/restart: сначала отключить MTProto, иначе AUTH_KEY_DUPLICATED. */
let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} — отключаю сессии…`);
  try {
    require('./services/helpRequestNotifier').stopNotificationBot?.();
  } catch (_) {}
  try {
    const n = await require('./services/clientPool').deactivateAllAccounts();
    console.log(`[shutdown] отключено сессий: ${n}`);
  } catch (e) {
    console.error('[shutdown]', e.message);
  }
  // Дать DC отпустить auth_key до нового connect.
  await new Promise((r) => setTimeout(r, 2500));
  process.exit(0);
}
// pm2 stop по умолчанию шлёт SIGINT — игнор ломал graceful disconnect → AUTH_KEY_DUPLICATED.
// Под pm2 процесс detached: случайный Ctrl+C SSH сюда не доходит.
process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM').catch(() => process.exit(1));
});
process.on('SIGINT', () => {
  gracefulShutdown('SIGINT').catch(() => process.exit(1));
});
