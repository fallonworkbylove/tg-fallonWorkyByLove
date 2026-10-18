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
  'dialogs',
];

const ACCOUNT_ID_COLUMNS = [
  ...CHILD_TABLES.map((table) => ({ table, column: 'account_id' })),
  { table: 'dating_site_accounts', column: 'telegram_account_id' },
  { table: 'dating_site_accounts', column: 'photo_reader_account_id' },
];

const TEMP_OFFSET = 1_000_000;

async function deleteFrom(table, accountId) {
  try {
    await db.execute(`DELETE FROM \`${table}\` WHERE account_id = ?`, [accountId]);
  } catch (err) {
    if (err.errno === 1146 || err.code === 'ER_NO_SUCH_TABLE') return;
    throw err;
  }
}

async function updateIdColumn(conn, table, column, fromId, toId) {
  try {
    await conn.execute(
      `UPDATE \`${table}\` SET \`${column}\` = ? WHERE \`${column}\` = ?`,
      [toId, fromId],
    );
  } catch (err) {
    if (err.errno === 1146 || err.code === 'ER_NO_SUCH_TABLE') return;
    if (err.errno === 1054 || err.code === 'ER_BAD_FIELD_ERROR') return;
    throw err;
  }
}

/**
 * Сжимает accounts.id в 1..N без дыр. Все FK account_id / telegram_account_id
 * тоже переезжают. Активные клиенты с изменившимся id переподключаются.
 * @returns {Map<number, number>} oldId → newId (только изменившиеся)
 */
async function compactAccountIds() {
  const [rows] = await db.execute(
    'SELECT id, session_string FROM accounts ORDER BY id ASC',
  );
  const mapping = new Map();
  for (let i = 0; i < rows.length; i += 1) {
    const newId = i + 1;
    if (Number(rows[i].id) !== newId) {
      mapping.set(Number(rows[i].id), newId);
    }
  }
  if (!mapping.size) {
    const next = rows.length + 1;
    try {
      await db.execute(`ALTER TABLE accounts AUTO_INCREMENT = ${next}`);
    } catch (_) {}
    return mapping;
  }

  let telegramClient = null;
  try {
    telegramClient = require('./telegramClient');
  } catch (_) {}

  const toReactivate = [];
  if (telegramClient) {
    for (const [oldId, newId] of mapping) {
      if (typeof telegramClient.isActive === 'function' && telegramClient.isActive(oldId)) {
        const row = rows.find((r) => Number(r.id) === oldId);
        if (row?.session_string) {
          toReactivate.push({ newId, session: row.session_string });
        }
        try {
          await telegramClient.deactivateAccount(oldId);
        } catch (_) {}
      }
    }
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('SET FOREIGN_KEY_CHECKS=0');

    for (const row of rows) {
      const oldId = Number(row.id);
      const tempId = TEMP_OFFSET + oldId;
      for (const { table, column } of ACCOUNT_ID_COLUMNS) {
        await updateIdColumn(conn, table, column, oldId, tempId);
      }
      await conn.execute('UPDATE accounts SET id = ? WHERE id = ?', [tempId, oldId]);
    }

    for (let i = 0; i < rows.length; i += 1) {
      const tempId = TEMP_OFFSET + Number(rows[i].id);
      const newId = i + 1;
      for (const { table, column } of ACCOUNT_ID_COLUMNS) {
        await updateIdColumn(conn, table, column, tempId, newId);
      }
      await conn.execute('UPDATE accounts SET id = ? WHERE id = ?', [newId, tempId]);
    }

    const next = rows.length + 1;
    await conn.query(`ALTER TABLE accounts AUTO_INCREMENT = ${next}`);
    await conn.query('SET FOREIGN_KEY_CHECKS=1');
    await conn.commit();
  } catch (err) {
    try {
      await conn.rollback();
    } catch (_) {}
    try {
      await conn.query('SET FOREIGN_KEY_CHECKS=1');
    } catch (_) {}
    throw err;
  } finally {
    conn.release();
  }

  if (telegramClient && toReactivate.length) {
    for (const item of toReactivate) {
      try {
        await telegramClient.activateAccount(item.newId, item.session);
      } catch (err) {
        console.error(
          `[accountCleanup] Не удалось переподключить id ${item.newId} после сжатия:`,
          err.message,
        );
      }
    }
  }

  console.log(
    `[accountCleanup] Сжаты id аккаунтов: ${[...mapping.entries()]
      .map(([a, b]) => `${a}→${b}`)
      .join(', ')}`,
  );
  return mapping;
}

async function purgeAccount(accountId, userId) {
  const id = Number(accountId);
  if (!Number.isFinite(id)) return false;

  if (userId != null) {
    const [[owned]] = await db.execute(
      'SELECT id FROM accounts WHERE id = ? AND user_id = ? LIMIT 1',
      [id, userId],
    );
    if (!owned) return false;
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
    await compactAccountIds();
  } catch (err) {
    console.error('[accountCleanup] Не удалось сжать id после удаления:', err.message);
  }
  return true;
}

module.exports = { purgeAccount, compactAccountIds };
