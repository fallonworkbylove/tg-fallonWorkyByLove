/**
 * Dating → Telegram outreach: когда парень на Tagged скинул свой @,
 * пишем ему первыми с MTProto-аккаунта девушки.
 */

const db = require('../db');
const telegramClient = require('./telegramClient');

function normalizeUsername(raw) {
  return String(raw || '')
    .trim()
    .replace(/^@/, '')
    .replace(/^https?:\/\/(t\.me|telegram\.me)\//i, '')
    .split(/[/?#\s]/)[0]
    .replace(/[^A-Za-z0-9_]/g, '')
    .slice(0, 32);
}

function isValidUsername(u) {
  // 5–32 символа — как в datingSitesStore / Telegram
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(u);
}

function defaultOpener({ personaName, language }) {
  const name = String(personaName || '').trim() || 'me';
  const ru = String(language || 'en').toLowerCase().startsWith('ru');
  if (ru) {
    const bank = [
      `привет, это ${name} с Tagged — тут удобнее писать`,
      `хай, нашла тебя) мы с Tagged переписывались`,
      `йоу это ${name} с Tagged, решила сразу сюда`,
    ];
    return bank[Math.floor(Math.random() * bank.length)];
  }
  const bank = [
    `hey it's ${name} from Tagged — easier to chat here`,
    `hi, found you — we were talking on Tagged`,
    `yo it's ${name} from Tagged, figured I'd text first`,
  ];
  return bank[Math.floor(Math.random() * bank.length)];
}

async function alreadyWrotePeer(accountId, peerUsername) {
  try {
    const [rows] = await db.execute(
      `SELECT id FROM conversation_messages
       WHERE account_id = ? AND peer_username = ? AND role = 'assistant'
       LIMIT 1`,
      [accountId, peerUsername],
    );
    return rows.length > 0;
  } catch (_) {
    return false;
  }
}

/**
 * @param {object} input
 * @param {number|null} [input.telegramAccountId] — accounts.id девушки
 * @param {string} [input.girlUsername] — её @ (fallback: match getMe)
 * @param {string} input.peerUsername — его @ с Tagged
 * @param {string} [input.personaName]
 * @param {string} [input.language]
 * @param {string} [input.message] — свой текст; иначе шаблон
 */
async function sendDatingOutreach(input = {}) {
  const peerUsername = normalizeUsername(input.peerUsername);
  if (!isValidUsername(peerUsername)) {
    const err = new Error('Некорректный username собеседника');
    err.code = 'bad_peer';
    throw err;
  }

  const girlUsername = normalizeUsername(input.girlUsername);
  if (girlUsername && girlUsername.toLowerCase() === peerUsername.toLowerCase()) {
    const err = new Error('Нельзя писать самой себе');
    err.code = 'self';
    throw err;
  }

  let accountId =
    input.telegramAccountId != null && input.telegramAccountId !== ''
      ? Number(input.telegramAccountId)
      : null;

  if (!accountId || !Number.isFinite(accountId)) {
    if (!girlUsername) {
      const err = new Error('Укажи telegram_account_id или girlUsername');
      err.code = 'no_girl';
      throw err;
    }
    accountId = await telegramClient.findActiveAccountIdByUsername(girlUsername);
  }

  if (!accountId) {
    const err = new Error(
      `Аккаунт девушки @${girlUsername || '?'} не онлайн (нет активной MTProto-сессии)`,
    );
    err.code = 'girl_offline';
    throw err;
  }

  if (!telegramClient.isActive(accountId)) {
    const err = new Error(`Аккаунт #${accountId} не активен`);
    err.code = 'girl_offline';
    throw err;
  }

  // Если передали и id, и @ — сверяем, что это один и тот же номер
  if (girlUsername) {
    const matched = await telegramClient.findActiveAccountIdByUsername(girlUsername);
    if (matched != null && Number(matched) !== Number(accountId)) {
      const err = new Error(
        `@${girlUsername} сидит на другом account_id (#${matched}), а не #${accountId}`,
      );
      err.code = 'girl_mismatch';
      throw err;
    }
  }

  if (await alreadyWrotePeer(accountId, peerUsername)) {
    return {
      ok: true,
      skipped: true,
      reason: 'already_wrote',
      accountId,
      peerUsername,
    };
  }

  const client = telegramClient.getActiveClient(accountId);
  if (!client) {
    const err = new Error(`Нет клиента для #${accountId}`);
    err.code = 'girl_offline';
    throw err;
  }

  let entity;
  try {
    entity = await client.getEntity(peerUsername);
  } catch (e) {
    const err = new Error(
      `Не нашла @${peerUsername} в Telegram: ${e.errorMessage || e.message}`,
    );
    err.code = 'peer_not_found';
    throw err;
  }

  const text = String(input.message || '').trim() ||
    defaultOpener({
      personaName: input.personaName,
      language: input.language,
    });

  try {
    await client.sendMessage(entity, { message: text.slice(0, 500) });
  } catch (e) {
    if (telegramClient.isPermanentSendError(e)) {
      const err = new Error(
        `Нельзя написать @${peerUsername}: ${e.errorMessage || e.message}`,
      );
      err.code = 'send_forbidden';
      throw err;
    }
    throw e;
  }

  const peerId = String(entity.id);
  try {
    await telegramClient.saveMessage(
      accountId,
      peerId,
      peerUsername,
      'assistant',
      text,
    );
  } catch (e) {
    console.error('[datingOutreach] saveMessage:', e.message);
  }

  console.log(
    `[datingOutreach] ${telegramClient.accountLabel(accountId)} → @${peerUsername}: ${text.slice(0, 80)}`,
  );

  return {
    ok: true,
    skipped: false,
    accountId,
    peerId,
    peerUsername,
    message: text,
  };
}

module.exports = {
  normalizeUsername,
  isValidUsername,
  defaultOpener,
  sendDatingOutreach,
};
