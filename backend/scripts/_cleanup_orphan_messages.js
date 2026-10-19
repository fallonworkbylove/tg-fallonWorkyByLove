#!/usr/bin/env node
/**
 * Удаляет conversation_messages (и опционально другие child-таблицы),
 * у которых account_id больше не существует в accounts.
 */
require('dotenv').config();
const db = require('../db');

const TABLES = [
  'conversation_messages',
  'daily_photo_sends',
  'pending_reactions_v2',
  'silence_pings',
  'silence_voice_daily',
  'help_requests',
  'autoreply_disabled_peers',
  'operator_lead_flags',
  'archived_peers',
  'cleared_peers',
  'nft_voice_schedule',
  'peer_memory_facts',
  'peer_self_told',
  'peer_compliment_state',
  'bot_peer_mood',
  'bot_peer_flash_emotion',
  'bot_mood',
  'account_persona',
  'dialogs',
  'training_examples',
];

(async () => {
  for (const table of TABLES) {
    try {
      const [result] = await db.execute(
        `DELETE t FROM \`${table}\` t
         LEFT JOIN accounts a ON a.id = t.account_id
         WHERE a.id IS NULL`,
      );
      console.log(table, 'deleted', result.affectedRows);
    } catch (err) {
      if (err.errno === 1146 || err.code === 'ER_NO_SUCH_TABLE') {
        console.log(table, 'skip (no table)');
        continue;
      }
      if (err.errno === 1054 || err.code === 'ER_BAD_FIELD_ERROR') {
        console.log(table, 'skip (no account_id)');
        continue;
      }
      throw err;
    }
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
