const db = require('../db');
const { activateAccount, normalizeLoginPhone } = require('./telegramClient');
const { clearDeadProxies } = require('./proxyPools');
const { activateInWaves, restoreBusyFromDb, ensureTables } = require('./scaleOps');

/**
 * Приводит все phone в accounts к E.164 (+7…).
 */
async function normalizeStoredPhones() {
  const [rows] = await db.execute(`SELECT id, phone FROM accounts`);
  let fixed = 0;
  for (const row of rows) {
    const next = normalizeLoginPhone(row.phone);
    if (!next || next === row.phone) continue;
    await db.execute(`UPDATE accounts SET phone = ? WHERE id = ?`, [next, row.id]);
    fixed += 1;
  }
  if (fixed > 0) {
    console.log(`[bootstrap] Нормализовано номеров: ${fixed}`);
  }
}

let bootstrapInFlight = null;

/**
 * При старте сервера поднимает аккаунты с сохранённой session_string волнами.
 * Отозванные сессии больше не удаляют строку — статус «Нужна авторизация».
 */
async function bootstrapSessions() {
  if (bootstrapInFlight) {
    console.warn('[bootstrap] уже идёт — второй вызов пропускаю');
    return bootstrapInFlight;
  }
  bootstrapInFlight = (async () => {
  try {
    await ensureTables();
    await normalizeStoredPhones();

    const [rows] = await db.execute(
      `SELECT a.id, a.phone, a.session_string
      FROM accounts a
      LEFT JOIN users u ON u.id = a.user_id
      WHERE a.session_string IS NOT NULL AND a.session_string != ''
        AND COALESCE(u.is_blocked, 0) = 0`,
    );

    if (rows.length === 0) {
      console.log('Активных сессий для восстановления нет.');
    } else {
      console.log(`Восстанавливаю ${rows.length} сессий волнами...`);
      const failed = [];
      const { ok, fail } = await activateInWaves(rows, async (account) => {
        clearDeadProxies();
        const result = await activateAccount(account.id, account.session_string);
        const status =
          result === true
            ? 'активирован'
            : result === 'revoked'
              ? 'сессия мертва → «Нужна авторизация» (промпт сохранён)'
              : 'ошибка';
        console.log(`  Аккаунт ${account.phone} (id=${account.id}): ${status}`);
        if (result !== true && result !== 'revoked') failed.push(account);
        return result === true;
      });
      console.log(`Восстановление сессий завершено (ok=${ok}, fail=${fail}).`);
      // AUTH_KEY: один отложенный retry (5м) — не 90с, пока zombie TCP ещё жив.
      if (failed.length) {
        const retryMs = 300_000;
        console.log(
          `[bootstrap] повтор ${failed.length} offline через ${Math.round(retryMs / 1000)}с…`,
        );
        setTimeout(() => {
          activateInWaves(failed, async (account) => {
            clearDeadProxies();
            const { isActive } = require('./clientPool');
            if (isActive(account.id)) return true;
            const result = await activateAccount(account.id, account.session_string);
            console.log(
              `  [retry] Аккаунт ${account.phone} (id=${account.id}): ${
                result === true ? 'активирован' : 'ошибка'
              }`,
            );
            return result === true;
          }).then(({ ok: o2, fail: f2 }) => {
            console.log(`[bootstrap] retry done ok=${o2} fail=${f2}`);
          });
        }, retryMs).unref?.();
      }
    }

    // #12 busy из БД после того как клиенты уже up
    try {
      const inbound = require('./inbound');
      const { getActiveClient } = require('./telegramClient');
      await restoreBusyFromDb(async ({ accountId, peerId, senderName, text, delayMs }) => {
        const client = getActiveClient(accountId);
        if (!client) return;
        const key = inbound.bufferKey(accountId, peerId);
        if (inbound.deferredDialogs.has(key)) return;
        let sender = peerId;
        try {
          sender = await client.getEntity(peerId);
        } catch (_) {
          /* fireReengage сам дорезолвит / выйдет */
        }
        const timer = setTimeout(() => {
          const hooksFire = require('./telegramClient').fireReengage;
          if (typeof hooksFire === 'function') {
            hooksFire(accountId, peerId).catch((e) =>
              console.error(`[bootstrap] busy restore fire:`, e.message),
            );
          }
        }, delayMs);
        if (typeof timer.unref === 'function') timer.unref();
        inbound.deferredDialogs.set(key, {
          timer,
          sender,
          senderName: senderName || peerId,
          history: [],
          text: text || '',
          message: null,
          fromDb: true,
        });
        console.log(
          `[bootstrap] «Занята» из БД: acc=${accountId} peer=${peerId} через ${Math.round(delayMs / 60000)}м`,
        );
      });
    } catch (e) {
      console.warn('[bootstrap] restore busy:', e.message);
    }
    try {
      await require('./humanHardening').restoreTextPromisesFromDb();
    } catch (e) {
      console.warn('[bootstrap] restore text promises:', e.message);
    }
    try {
      await require('./memoryTriggers').pruneOldMemory();
    } catch (e) {
      console.warn('[bootstrap] prune memory:', e.message);
    }
  } catch (err) {
    console.error('Ошибка восстановления сессий:', err.message);
  }
  })();
  try {
    await bootstrapInFlight;
  } finally {
    bootstrapInFlight = null;
  }
}

module.exports = { bootstrapSessions, normalizeStoredPhones };
