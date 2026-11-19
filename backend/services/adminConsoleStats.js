/**
 * Снимок для админ-консоли (веб-оверлей): сообщения день/неделя/месяц + аккаунты.
 * Окно суток — 00:00 МСК, как в adminMenu.
 */

const db = require('../db');

/** Имя персонажа из промпта — fallback, если Telegram getMe ещё не в кэше.
 *  Типичный старт: «Ты — Кира, 24 года.» (\b в JS не работает с кириллицей). */
function nameFromPrompt(prompt) {
  const p = String(prompt || '');
  if (!p.trim()) return null;
  const patterns = [
    // «Ты — Машенька, 26» / «Ты — Арина (Арина Архипова), 26»
    /^ты\s*[—\-–−]\s*([А-ЯЁA-Z][а-яёa-zA-ZёЁ\-']{1,24})(?:\s*\(([^)]{2,40})\))?/im,
    /тебя\s+зовут\s+([А-ЯЁA-Z][а-яёa-zA-ZёЁ\-']{1,24})/i,
    /меня\s+зовут\s+([А-ЯЁA-Z][а-яёa-zA-ZёЁ\-']{1,24})/i,
    /имя\s*[:\-–—]\s*([А-ЯЁA-Z][а-яёa-zA-ZёЁ\-']{1,24})/i,
    /your\s+name\s+is\s+([A-Z][a-zA-Z\-']{1,24})/i,
  ];
  for (const re of patterns) {
    const m = p.match(re);
    if (!m || !m[1]) continue;
    if (/^(девушка|бот|человек|женщина|girl|woman)$/i.test(m[1])) continue;
    // Если в скобках полное ФИО — предпочитаем его («Арина Архипова»).
    const paren = String(m[2] || '').trim();
    if (paren && /[А-ЯЁA-Z]/.test(paren) && paren.length <= 40) return paren;
    return m[1];
  }
  return null;
}

function sqlMskDayStart(daysAgo = 0) {
  const d = Math.max(0, Number(daysAgo) || 0);
  return (
    `DATE_ADD(DATE_ADD(DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 HOUR)), ` +
    `INTERVAL -${d} DAY), INTERVAL -3 HOUR)`
  );
}

async function periodCounts(sinceSql) {
  const [[m]] = await db.execute(
    `SELECT
       SUM(role = 'assistant') AS sent,
       SUM(role = 'assistant' AND content LIKE '[реакция:%') AS reactions,
       SUM(role = 'user') AS incoming,
       COUNT(DISTINCT CASE WHEN role = 'assistant' THEN CONCAT(account_id, ':', peer_id) END) AS chats
     FROM conversation_messages
     WHERE created_at >= ${sinceSql}`,
  );
  return {
    sent: Number(m?.sent || 0),
    reactions: Number(m?.reactions || 0),
    incoming: Number(m?.incoming || 0),
    chats: Number(m?.chats || 0),
  };
}

async function getConsoleSnapshot() {
  const daySql = sqlMskDayStart(0);
  const weekSql = sqlMskDayStart(6);
  const monthSql = sqlMskDayStart(29);

  const [day, week, month] = await Promise.all([
    periodCounts(daySql),
    periodCounts(weekSql),
    periodCounts(monthSql),
  ]);

  const [accountRows] = await db.execute(
    `SELECT a.id, a.seq, a.phone, a.prompt, a.status,
            a.is_autoreply_enabled AS ai,
            a.reply_delay_min, a.reply_delay_max, a.media_chat_link,
            a.created_at, a.updated_at,
            u.username, u.first_name, u.telegram_user_id AS owner_tg,
            (SELECT COUNT(*) FROM conversation_messages m
              WHERE m.account_id = a.id AND m.role = 'assistant'
                AND m.created_at >= ${daySql}) AS sent_today,
            (SELECT COUNT(*) FROM conversation_messages m
              WHERE m.account_id = a.id AND m.role = 'assistant'
                AND m.created_at >= ${weekSql}) AS sent_week,
            (SELECT COUNT(DISTINCT peer_id) FROM conversation_messages m
              WHERE m.account_id = a.id) AS peers_total
     FROM accounts a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE COALESCE(u.is_blocked, 0) = 0
     ORDER BY sent_today DESC, COALESCE(a.seq, a.id)`,
  );

  let online = 0;
  let liveNameFn = () => null;
  try {
    const tc = require('./telegramClient');
    liveNameFn = (id) => {
      try {
        if (typeof tc.accountDisplayName === 'function') {
          const n = tc.accountDisplayName(id);
          if (n) return n;
        }
        const label = String(tc.accountLabel(id) || '');
        if (!label || /^ID\s/i.test(label)) return null;
        const parts = label.split(' — ');
        if (parts.length >= 2) {
          const n = parts.slice(1).join(' — ').trim();
          return n || null;
        }
        if (!/^\+?\d[\d\s-]{6,}$/.test(label.trim())) return label.trim();
        return null;
      } catch (_) {
        return null;
      }
    };
    online = accountRows.filter((r) => {
      try {
        return tc.isActive(r.id);
      } catch (_) {
        return false;
      }
    }).length;
  } catch (_) {}

  const aiOn = accountRows.filter((r) => Number(r.ai)).length;
  let lastReplyByAcc = new Map();
  try {
    const [lrRows] = await db.execute(
      `SELECT account_id,
              TIMESTAMPDIFF(MINUTE, MAX(created_at), NOW()) AS age_min
       FROM conversation_messages
       WHERE role = 'assistant'
       GROUP BY account_id`,
    );
    for (const row of lrRows || []) {
      lastReplyByAcc.set(Number(row.account_id), Number(row.age_min));
    }
  } catch (_) {
    lastReplyByAcc = new Map();
  }

  const accounts = accountRows.map((r) => {
    let isOnline = false;
    try {
      isOnline = require('./telegramClient').isActive(r.id);
    } catch (_) {}
    const liveName = liveNameFn(r.id);
    const promptName = nameFromPrompt(r.prompt);
    let tgUsername = '';
    try {
      const { getAccountUsernameSync } = require('./clientPool');
      if (typeof getAccountUsernameSync === 'function') {
        tgUsername = String(getAccountUsernameSync(r.id) || '').replace(/^@/, '');
      }
    } catch (_) {}
    const unameLabel = tgUsername ? `@${tgUsername}` : null;
    const name = liveName || promptName || unameLabel || null;
    const lastReplyAgeMin = lastReplyByAcc.has(Number(r.id))
      ? lastReplyByAcc.get(Number(r.id))
      : null;
    // #24/#31: health score на карточке (без тяжёлого per-row DB).
    let health = 40;
    if (isOnline) health += 25;
    if (Number(r.ai)) health += 15;
    if (lastReplyAgeMin != null && lastReplyAgeMin <= 30) health += 15;
    else if (lastReplyAgeMin != null && lastReplyAgeMin <= 120) health += 8;
    else if (lastReplyAgeMin != null && lastReplyAgeMin > 360) health -= 10;
    health = Math.max(0, Math.min(100, health));
    return {
      id: r.id,
      seq: r.seq,
      phone: r.phone,
      name,
      username: tgUsername || null,
      nameSource: liveName ? 'telegram' : promptName ? 'prompt' : unameLabel ? 'username' : null,
      owner: r.username ? `@${r.username}` : r.first_name || null,
      ownerTg: r.owner_tg != null ? String(r.owner_tg) : null,
      status: r.status || null,
      // Полный промпт не отдаём в snapshot — только превью (защита при утечке токена).
      prompt: String(r.prompt || '').slice(0, 280),
      promptLen: String(r.prompt || '').length,
      hasPrompt: Boolean(String(r.prompt || '').trim()),
      ai: Boolean(Number(r.ai)),
      online: Boolean(isOnline),
      delayMin: r.reply_delay_min != null ? Number(r.reply_delay_min) : null,
      delayMax: r.reply_delay_max != null ? Number(r.reply_delay_max) : null,
      mediaChatLink: r.media_chat_link || null,
      createdAt: r.created_at || null,
      updatedAt: r.updated_at || null,
      peersTotal: Number(r.peers_total || 0),
      sentToday: Number(r.sent_today || 0),
      sentWeek: Number(r.sent_week || 0),
      lastReplyAgeMin,
      queueDepth: 0,
      health,
      pool: r.username ? String(r.username) : 'default',
    };
  });

  let hot = 0;
  try {
    const [[h]] = await db.execute(
      `SELECT COUNT(*) AS c FROM operator_lead_flags
       WHERE funnel_stage IN ('day3', 'day4', 'interest', 'pitch', 'operator')`,
    );
    hot = Number(h?.c || 0);
  } catch (_) {}

  let funnel = null;
  try {
    const lead = require('./leadScoring');
    funnel = await lead.listGlobalScoredConversations({ limit: 450 });
  } catch (err) {
    console.warn('[adminConsoleStats] funnel:', err.message);
  }

  let liveMetrics = null;
  try {
    liveMetrics = await require('./opsLiveMetrics').getLiveMetrics();
  } catch (e) {
    console.warn('[adminConsoleStats] liveMetrics:', e.message);
  }

  let cost = null;
  try {
    cost = await require('./finetuneUsage').getCostSummary();
  } catch (e) {
    console.warn('[adminConsoleStats] cost:', e.message);
  }

  let proxyHealth = null;
  try {
    proxyHealth = require('./adminOps').listProxies()?.summary || null;
  } catch (e) {
    console.warn('[adminConsoleStats] proxyHealth:', e.message);
  }

  const nft = liveMetrics?.nftFunnel || {};
  const funnelBoard = {
    scheduleTotal: Number(nft.scheduleTotal || 0),
    workPending: Number(nft.workPending || 0),
    openWork: Number(nft.openWork ?? nft.workPending ?? 0),
    workSent: Number(nft.workSent || 0),
    voice7d: Number(nft.voice7d || 0),
    stuckWorkNoVoice: Number(nft.stuckWorkNoVoice || 0),
    staleDialog: Number(nft.staleDialog || 0),
    liveDialog90: Number(nft.liveDialog90 || 0),
    voiceArchive7d: Number(nft.voice7d || 0),
    campaignArchive: {
      voice7d: Number(nft.voice7d || 0),
      workSent: Number(nft.workSent || 0),
      stuck: Number(nft.stuckWorkNoVoice || 0),
      stale: Number(nft.staleDialog || 0),
    },
    hotLeads: hot,
  };

  const radar = {
    repliesPerHour: Number(liveMetrics?.repliesPerHour || 0),
    silenceHeal: Number(liveMetrics?.process?.silenceHeal || 0),
    nearDupSkip: Number(liveMetrics?.process?.nearDupSkip || 0),
    trashFilter: Number(liveMetrics?.process?.trashFilter || 0),
    howlongToday: Number(liveMetrics?.dayMsk?.howlong || 0),
    filtered: Number(liveMetrics?.dayMsk?.filtered || 0),
    topCliches: Array.isArray(liveMetrics?.topCliches) ? liveMetrics.topCliches.slice(0, 5) : [],
    staleAi: Array.isArray(liveMetrics?.staleAiAccounts) ? liveMetrics.staleAiAccounts.length : 0,
    lastReplyAgeMin: liveMetrics?.health?.lastReplyAgeMin ?? null,
  };

  return {
    computedAt: Date.now(),
    timezone: 'Europe/Moscow',
    messages: { day, week, month },
    accounts: {
      total: accounts.length,
      online,
      aiOn,
      // Полный список для OPS desktop (раньше резали до 40 — часть аккаунтов пропадала).
      list: accounts,
    },
    hotLeads: hot,
    funnel,
    funnelBoard,
    radar,
    cost,
    proxyHealth,
    liveMetrics,
  };
}

module.exports = { getConsoleSnapshot, sqlMskDayStart, nameFromPrompt };
