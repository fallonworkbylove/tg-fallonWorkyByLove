const express = require('express');
const router = express.Router();
const operatorAccess = require('../services/operatorAccess');
const { getConsoleSnapshot } = require('../services/adminConsoleStats');
const ops = require('../services/adminOps');

async function requireAdmin(req, res) {
  if (req.adminConsoleAuth) return true;
  const tgId = req.telegramUser?.id ?? req.dbUser?.telegram_user_id;
  const username = req.telegramUser?.username || req.dbUser?.username;
  if (tgId == null && !username) {
    res.status(401).json({ success: false, error: 'Нужен X-Admin-Console-Token' });
    return false;
  }
  const ok = await operatorAccess.isAdmin(tgId, username);
  if (!ok) {
    res.status(403).json({ success: false, error: 'Только для админа' });
    return false;
  }
  return true;
}

function fail(res, error) {
  const status = Number(error?.statusCode) || 500;
  return res.status(status).json({
    success: false,
    error: error?.message || 'Ошибка',
  });
}

router.get('/', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const console_ = await getConsoleSnapshot();
    return res.json({ success: true, console: console_ });
  } catch (error) {
    console.error('admin console error:', error);
    return res.status(500).json({ success: false, error: 'Не удалось собрать консоль' });
  }
});

/* ——— ЧС ——— */
router.get('/blacklist', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const blacklist = await ops.listBlacklist({ limit: req.query.limit });
    return res.json({ success: true, blacklist });
  } catch (error) {
    console.error('admin blacklist list:', error);
    return fail(res, error);
  }
});

router.post('/blacklist', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const result = await ops.addBlacklist({
      input: req.body?.input || req.body?.username || req.body?.peerId || req.body?.userTelegramId,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('admin blacklist add:', error);
    return fail(res, error);
  }
});

router.delete('/blacklist/:telegramId', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const result = await ops.removeBlacklist(req.params.telegramId);
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('admin blacklist del:', error);
    return fail(res, error);
  }
});

/* ——— Аккаунты / AI ——— */
router.post('/accounts', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const account = await ops.createAccount({
      phone: req.body?.phone,
      prompt: req.body?.prompt,
      ownerTelegramId: req.body?.ownerTelegramId,
    });
    return res.status(201).json({ success: true, account });
  } catch (error) {
    console.error('admin create account:', error);
    return fail(res, error);
  }
});

/* bulk / connect до :id, иначе Express съест «bulk» как id */
router.post('/accounts/bulk/start-ai', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const result = await ops.bulkAi(true, req.body?.ids);
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('admin bulk start-ai:', error);
    return fail(res, error);
  }
});

router.post('/accounts/bulk/stop-ai', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const result = await ops.bulkAi(false, req.body?.ids);
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('admin bulk stop-ai:', error);
    return fail(res, error);
  }
});

router.post('/accounts/connect/start', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const result = await ops.connectStart({
      phone: req.body?.phone,
      ownerTelegramId: req.body?.ownerTelegramId,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('admin connect start:', error);
    return fail(res, error);
  }
});

router.post('/accounts/connect/resend', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const result = await ops.connectResend({
      phone: req.body?.phone,
      ownerTelegramId: req.body?.ownerTelegramId,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('admin connect resend:', error);
    return fail(res, error);
  }
});

router.post('/accounts/connect/code', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const result = await ops.connectCode({
      phone: req.body?.phone,
      code: req.body?.code,
      ownerTelegramId: req.body?.ownerTelegramId,
      prompt: req.body?.prompt,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('admin connect code:', error);
    return fail(res, error);
  }
});

router.post('/accounts/connect/password', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const result = await ops.connectPassword({
      phone: req.body?.phone,
      password: req.body?.password,
      ownerTelegramId: req.body?.ownerTelegramId,
      prompt: req.body?.prompt,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('admin connect password:', error);
    return fail(res, error);
  }
});

router.delete('/accounts/:id', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const result = await ops.deleteAccount(req.params.id);
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('admin delete account:', error);
    return fail(res, error);
  }
});

router.post('/accounts/:id/start-ai', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const result = await ops.startAi(req.params.id);
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('admin start-ai:', error);
    return fail(res, error);
  }
});

router.post('/accounts/:id/stop-ai', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const result = await ops.stopAi(req.params.id);
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('admin stop-ai:', error);
    return fail(res, error);
  }
});

router.get('/accounts/:id/ping', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const result = await ops.sessionPing(req.params.id);
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('admin ping:', error);
    return fail(res, error);
  }
});

/* ——— Прокси ——— */
router.get('/proxies', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    return res.json({ success: true, proxies: ops.listProxies() });
  } catch (error) {
    console.error('admin proxies:', error);
    return fail(res, error);
  }
});

router.post('/proxies/check', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const result = await ops.checkProxies({ pool: req.body?.pool || req.query?.pool || 'all' });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('admin proxies check:', error);
    return fail(res, error);
  }
});

/* ——— Логи ——— */
router.get('/logs', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const data = ops.getLogs({
      limit: req.query.limit,
      afterId: req.query.afterId,
    });
    return res.json({ success: true, ...data });
  } catch (error) {
    console.error('admin logs:', error);
    return fail(res, error);
  }
});

router.delete('/logs', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const data = ops.clearLogs();
    return res.json({ success: true, ...data });
  } catch (error) {
    console.error('admin logs clear:', error);
    return fail(res, error);
  }
});

/* ——— Лента событий (как уведомления бота: медиа / NFT / лид) ——— */
router.get('/activity', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const data = await ops.listActivity({
      limit: req.query.limit,
      afterId: req.query.afterId,
      kind: req.query.kind || null,
    });
    return res.json({ success: true, ...data });
  } catch (error) {
    console.error('admin activity:', error);
    return fail(res, error);
  }
});

/* ——— Живые метрики (Electron OPS, только админ) ——— */
router.get('/metrics', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const metrics = await require('../services/opsLiveMetrics').getLiveMetrics();
    return res.json({ success: true, metrics });
  } catch (error) {
    console.error('admin metrics:', error);
    return fail(res, error);
  }
});

router.get('/health', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const metrics = await require('../services/opsLiveMetrics').getLiveMetrics();
    return res.json({ success: true, health: metrics.health || {}, staleAi: metrics.staleAiAccounts || [] });
  } catch (error) {
    console.error('admin health:', error);
    return fail(res, error);
  }
});

router.post('/notifier/restart', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const help = require('../services/helpRequestNotifier');
    const r = help.restartNotificationBot();
    return res.json({ success: true, ...r });
  } catch (error) {
    console.error('admin notifier restart:', error);
    return fail(res, error);
  }
});

router.get('/accounts/:id/persona-preview', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const preview = await ops.personaPreview(req.params.id);
    return res.json({ success: true, preview });
  } catch (error) {
    console.error('admin persona-preview:', error);
    return fail(res, error);
  }
});

router.post('/learn/bad-reply', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const result = await ops.flagBadReply({
      trigger: req.body?.trigger || req.body?.userMsg || '',
      reply: req.body?.reply || req.body?.botReply || '',
      stage: req.body?.stage || 'general',
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('admin bad-reply:', error);
    return fail(res, error);
  }
});

/* ——— 0m1 scale pack: day-N / voice A/B / health / errors / CSV / ideas ——— */
router.get('/scale/day-n', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const pack = require('../services/scaleIdeasPack');
    const dayN = await pack.getDayNFunnelWeek();
    const voice = await pack.getVoiceAbStats();
    const winner = await pack.getVoiceAbWinner({ minN: 40 });
    const voiceMode = pack.voiceAbMode();
    return res.json({
      success: true,
      dayN,
      voice,
      winner: voiceMode.abEnabled ? winner : null,
      voiceMode,
    });
  } catch (error) {
    console.error('admin scale day-n:', error);
    return fail(res, error);
  }
});

router.get('/scale/errors', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const limit = Number(req.query.limit) || 40;
    const errors = require('../services/scaleIdeasPack').getAdminErrorFeed(limit);
    return res.json({ success: true, errors });
  } catch (error) {
    console.error('admin scale errors:', error);
    return fail(res, error);
  }
});

router.get('/scale/health/:id', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const health = await require('../services/scaleIdeasPack').computeAccountHealth(req.params.id);
    return res.json({ success: true, health });
  } catch (error) {
    console.error('admin scale health:', error);
    return fail(res, error);
  }
});

router.get('/scale/compare', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const a = Number(req.query.a);
    const b = Number(req.query.b);
    if (!a || !b) {
      return res.status(400).json({ success: false, error: 'Нужны a и b (id аккаунтов)' });
    }
    const cmp = await require('../services/scaleIdeasPack').compareAccounts(a, b);
    return res.json({ success: true, compare: cmp });
  } catch (error) {
    console.error('admin scale compare:', error);
    return fail(res, error);
  }
});

router.get('/scale/pools', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const pools = await require('../services/scaleIdeasPack').listAccountPools();
    return res.json({ success: true, pools });
  } catch (error) {
    console.error('admin scale pools:', error);
    return fail(res, error);
  }
});

router.post('/scale/pools', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const accountId = Number(req.body?.accountId);
    if (!accountId) {
      return res.status(400).json({ success: false, error: 'accountId обязателен' });
    }
    await require('../services/scaleIdeasPack').setAccountPool(accountId, {
      poolKey: req.body?.poolKey || 'default',
      ownerLabel: req.body?.ownerLabel || null,
      city: req.body?.city || null,
    });
    return res.json({ success: true });
  } catch (error) {
    console.error('admin scale pools set:', error);
    return fail(res, error);
  }
});

router.get('/scale/metrics.csv', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const csv = await require('../services/scaleIdeasPack').buildMetricsCsvDay();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="loverussian-metrics-day.csv"');
    return res.send(csv);
  } catch (error) {
    console.error('admin scale csv:', error);
    return fail(res, error);
  }
});

router.get('/scale/smoke-checklist', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const fs = require('fs');
    const path = require('path');
    const changelog = fs.readFileSync(
      path.join(__dirname, '../../CHANGELOG_TG.md'),
      'utf8',
    );
    const checklist = require('../services/scaleIdeasPack').buildChangelogSmokeChecklist(
      changelog,
      { limit: 10 },
    );
    return res.json({ success: true, checklist });
  } catch (error) {
    console.error('admin scale smoke-checklist:', error);
    return fail(res, error);
  }
});

router.get('/scale/idea-day', async (req, res) => {
  try {
    const tgId = req.telegramUser?.id ?? req.dbUser?.telegram_user_id;
    const username = req.telegramUser?.username || req.dbUser?.username;
    const pack = require('../services/scaleIdeasPack');
    // #50: только создатель fallonsociapat (или суперадмин).
    const isCreator = pack.isCreatorUser(username, tgId);
    const isAdmin = await operatorAccess.isAdmin(tgId, username);
    if (!isCreator && !isAdmin && !req.adminConsoleAuth) {
      return res.status(403).json({ success: false, error: 'Только создатель / админ' });
    }
    if (!isCreator && !req.adminConsoleAuth) {
      // админ видит, но пометка not creator
      const idea = await pack.getIdeaOfDay();
      return res.json({ success: true, idea, creatorOnly: false });
    }
    const idea = await pack.getIdeaOfDay();
    return res.json({ success: true, idea, creatorOnly: true });
  } catch (error) {
    console.error('admin scale idea-day:', error);
    return fail(res, error);
  }
});

/* ——— NFT funnel: закрыть мёртвые stuck после «по работе» ——— */
router.post('/nft/expire-stale', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const db = require('../db');
    const nft = require('../services/nftCampaign');
    await nft.ensureNftScheduleTable();
    const [accs] = await db.execute(
      `SELECT DISTINCT account_id AS id FROM nft_voice_schedule WHERE work_mention_sent = 1`,
    );
    let expired = 0;
    for (const a of accs || []) {
      expired += Number(await nft.expireStaleNftAfterWork(a.id)) || 0;
    }
    const metrics = await require('../services/opsLiveMetrics').getLiveMetrics();
    const board = metrics?.nftFunnel || {};
    return res.json({
      success: true,
      expired,
      stuckWorkNoVoice: Number(board.stuckWorkNoVoice || 0),
      staleDialog: Number(board.staleDialog || 0),
      openWork: Number(board.openWork || board.workPending || 0),
      liveDialog90: Number(board.liveDialog90 || 0),
    });
  } catch (error) {
    console.error('admin nft expire-stale:', error);
    return fail(res, error);
  }
});

module.exports = router;
