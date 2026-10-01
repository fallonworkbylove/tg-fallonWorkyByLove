/**
 * Аккаунты сайтов знакомств (Tagged) для операторов miniapp.
 * Каждый сайт-аккаунт привязан к Telegram-хэндлу для инвайта / outreach.
 */

const express = require('express');
const { requireBetaTester } = require('../services/featureFlags');
const store = require('../services/datingSitesStore');
const datingOutreach = require('../services/datingOutreach');

const router = express.Router();

function getUserId(req) {
  return req.dbUser ? req.dbUser.id : 1;
}

function allowWorkerOrBeta(req, res, next) {
  if (req.datingWorker) return next();
  return requireBetaTester(req, res, next);
}

/**
 * Tagged-воркер: парень скинул свой @ → пишем ему первыми с TG-аккаунта девушки.
 * Auth: X-Dating-Worker-Secret == DATING_WORKER_SECRET  ИЛИ  beta miniapp.
 */
router.post('/outreach', allowWorkerOrBeta, async (req, res) => {
  try {
    const body = req.body || {};
    const result = await datingOutreach.sendDatingOutreach({
      telegramAccountId: body.telegram_account_id ?? body.telegramAccountId,
      girlUsername: body.girl_username || body.girlUsername,
      peerUsername: body.peer_username || body.peerUsername,
      personaName: body.persona_name || body.personaName,
      language: body.language,
      message: body.message,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    const code = err.code || 'error';
    const status =
      code === 'bad_peer' || code === 'self' || code === 'no_girl'
        ? 400
        : code === 'girl_offline' || code === 'peer_not_found' || code === 'send_forbidden'
          ? 409
          : 500;
    console.error('[datingSites] outreach:', err.message);
    res.status(status).json({
      success: false,
      error: err.message || 'Не удалось написать в Telegram',
      code,
    });
  }
});

router.use(requireBetaTester);

router.get('/', async (req, res) => {
  try {
    const rows = await store.listAccounts({ userId: getUserId(req) });
    res.json({ success: true, accounts: rows.map(store.publicRow) });
  } catch (err) {
    console.error('[datingSites] list:', err.message);
    res.status(500).json({ success: false, error: 'Не удалось загрузить сайты' });
  }
});

/** Пример фразы инвайта (без сохранения). */
router.get('/invite-preview', (req, res) => {
  const tg = store.normalizeTg(req.query.tg || req.query.telegram_username || 'username');
  const lang = String(req.query.lang || 'en').toLowerCase().startsWith('ru') ? 'ru' : 'en';
  const phrase = store.invitePhrase(tg, lang);
  res.json({
    success: true,
    telegram_display: `@${tg}`,
    phrase,
    language: lang,
  });
});

/**
 * Экспорт для Playwright-воркера (tagged/accounts.from-db.json).
 */
router.post('/export-worker', async (req, res) => {
  try {
    const result = await store.exportWorker({ userId: getUserId(req) });
    res.json({
      success: true,
      count: result.count,
      file: result.file,
      message: `Экспортировано аккаунтов: ${result.count}`,
    });
  } catch (err) {
    console.error('[datingSites] export-worker:', err.message);
    res.status(500).json({ success: false, error: 'Не удалось экспортировать' });
  }
});

router.post('/', async (req, res) => {
  try {
    const row = await store.createAccount(getUserId(req), req.body || {});
    res.json({ success: true, account: store.publicRow(row) });
  } catch (err) {
    const msg = String(err.message || '');
    const known =
      /Неизвестный|Укажите|Некорректный|уже подключён|не найден/.test(msg);
    console.error('[datingSites] create:', msg);
    res.status(known ? 400 : 500).json({
      success: false,
      error: known ? msg : 'Не удалось сохранить аккаунт сайта',
    });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const row = await store.updateAccount(
      Number(req.params.id),
      req.body || {},
      getUserId(req),
    );
    res.json({ success: true, account: store.publicRow(row) });
  } catch (err) {
    const msg = String(err.message || '');
    const code = /не найден/i.test(msg) ? 404 : /Неизвестный|обязательны|Некорректный/.test(msg) ? 400 : 500;
    console.error('[datingSites] patch:', msg);
    res.status(code).json({
      success: false,
      error: code === 500 ? 'Не удалось обновить' : msg,
    });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const ok = await store.deleteAccount(Number(req.params.id), getUserId(req));
    if (!ok) {
      return res.status(404).json({ success: false, error: 'Аккаунт не найден' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[datingSites] delete:', err.message);
    res.status(500).json({ success: false, error: 'Не удалось удалить' });
  }
});

module.exports = router;
module.exports.ensureSchema = store.ensureSchema;
