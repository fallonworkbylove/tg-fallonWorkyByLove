const db = require('../db');

const CHILD_TABLES = [
  'conversation_messages',
  'training_examples',
  'pending_reactions',
  'pending_reactions_v2',
  'silence_pings',
  'silence_voice_daily',
  'silence_voice_reminders',
  'peer_compliment_state',
  'bot_peer_mood',
  'bot_peer_flash_emotion',
  'bot_mood',
  'nft_voice_schedule',
  'daily_photo_sends',
  'peer_memory_facts',
  'peer_self_told',
  'help_requests',
  'autoreply_disabled_peers',
  'account_persona',
  'archived_peers',
  'cleared_peers',
  'operator_lead_flags',
  'account_notify_delegates',
  'dialogs',
];

let seqReady = false;
let seqBootstrapped = false;
/** Очередь: renumber и purge не гоняем параллельно (иначе FK/lock гонки). */
let seqChain = Promise.resolve();

async function deleteFrom(table, accountId) {
  try {
    await db.execute(`DELETE FROM \`${table}\` WHERE account_id = ?`, [accountId]);
  } catch (err) {
    if (err.errno === 1146 || err.code === 'ER_NO_SUCH_TABLE') return;
    throw err;
  }
}

/**
 * accounts.seq — порядковый номер 1…N внутри user_id (без дыр).
 * accounts.id при этом никогда не трогаем.
 */
async function ensureSeqColumn() {
  if (seqReady) return;
  try {
    await db.execute(
      'ALTER TABLE accounts ADD COLUMN seq INT NULL DEFAULT NULL AFTER id',
    );
  } catch (err) {
    if (err.errno !== 1060 && err.code !== 'ER_DUP_FIELDNAME') throw err;
  }
  seqReady = true;
}

async function renumberAccountSeqUnlocked(userId) {
  await ensureSeqColumn();
  if (userId != null) {
    await db.execute(
      `UPDATE accounts a
       JOIN (
         SELECT id, ROW_NUMBER() OVER (ORDER BY id ASC) AS rn
         FROM accounts
         WHERE user_id = ?
       ) t ON a.id = t.id
       SET a.seq = t.rn`,
      [userId],
    );
    return;
  }
  await db.execute(
    `UPDATE accounts a
     JOIN (
       SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY id ASC) AS rn
       FROM accounts
     ) t ON a.id = t.id
     SET a.seq = t.rn`,
  );
}

function enqueueSeq(task) {
  const run = seqChain.then(task);
  seqChain = run.catch(() => {});
  return run;
}

function renumberAccountSeq(userId) {
  return enqueueSeq(() => renumberAccountSeqUnlocked(userId));
}

/** Старт сервера: колонка + однократное первичное заполнение seq. */
async function ensureAccountSeqSchema() {
  await ensureSeqColumn();
  if (seqBootstrapped) return;
  try {
    await renumberAccountSeq();
    seqBootstrapped = true;
  } catch (err) {
    console.error('[accountCleanup] Первичный пересчёт seq не удался:', err.message);
    throw err;
  }
}

async function purgeAccountUnlocked(accountId, userId) {
  const id = Number(accountId);
  if (!Number.isFinite(id)) return false;

  let ownerUserId = userId != null ? Number(userId) : null;

  if (ownerUserId != null) {
    const [[owned]] = await db.execute(
      'SELECT id, user_id FROM accounts WHERE id = ? AND user_id = ? LIMIT 1',
      [id, ownerUserId],
    );
    if (!owned) return false;
    ownerUserId = Number(owned.user_id);
  } else {
    const [[row]] = await db.execute(
      'SELECT user_id FROM accounts WHERE id = ? LIMIT 1',
      [id],
    );
    if (!row) return false;
    ownerUserId = row.user_id != null ? Number(row.user_id) : null;
  }

  for (const table of CHILD_TABLES) {
    await deleteFrom(table, id);
  }

  try {
    await db.execute(
      'UPDATE dating_site_accounts SET telegram_account_id = NULL WHERE telegram_account_id = ?',
      [id],
    );
    await db.execute(
      'UPDATE dating_site_accounts SET photo_reader_account_id = NULL WHERE photo_reader_account_id = ?',
      [id],
    );
  } catch (_) {}

  const [result] = await db.execute('DELETE FROM accounts WHERE id = ?', [id]);
  if (result.affectedRows <= 0) return false;

  try {
    if (ownerUserId != null) await renumberAccountSeqUnlocked(ownerUserId);
    else await renumberAccountSeqUnlocked();
  } catch (err) {
    console.error('[accountCleanup] Не удалось пересчитать seq после удаления:', err.message);
  }
  return true;
}

function purgeAccount(accountId, userId) {
  return enqueueSeq(() => purgeAccountUnlocked(accountId, userId));
}

module.exports = {
  purgeAccount,
  renumberAccountSeq,
  ensureAccountSeqSchema,
};
