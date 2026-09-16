const db = require('../db');

const CHILD_TABLES = [
  'conversation_messages',
  'training_examples',
  'pending_reactions_v2',
  'silence_pings',
  'silence_voice_daily',
  'peer_compliment_state',
  'bot_peer_mood',
  'bot_mood',
  'nft_voice_schedule',
  'daily_photo_sends',
  'peer_memory_facts',
  'help_requests',
  'autoreply_disabled_peers',
];

async function deleteFrom(table, accountId) {
  try {
    await db.execute(`DELETE FROM \`${table}\` WHERE account_id = ?`, [accountId]);
  } catch (err) {
    if (err.errno === 1146 || err.code === 'ER_NO_SUCH_TABLE') return;
    throw err;
  }
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

  const [result] = await db.execute('DELETE FROM accounts WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

module.exports = { purgeAccount };
