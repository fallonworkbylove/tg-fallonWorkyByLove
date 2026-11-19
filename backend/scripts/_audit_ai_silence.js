#!/usr/bin/env node
/**
 * Почему AI может молчать: флаги аккаунтов, пустые промпты, online vs ai.
 */
require('dotenv').config();
const db = require('../db');

(async () => {
  const [rows] = await db.execute(
    `SELECT id, phone, status,
            is_autoreply_enabled AS ai,
            CASE WHEN session_string IS NULL OR session_string = '' THEN 0 ELSE 1 END AS has_session,
            CASE WHEN prompt IS NULL OR TRIM(prompt) = '' THEN 0 ELSE 1 END AS has_prompt,
            CHAR_LENGTH(IFNULL(prompt,'')) AS prompt_len,
            reply_delay_min, reply_delay_max
     FROM accounts
     ORDER BY id`,
  );
  console.log('id\tphone\tai\tsession\tprompt\tplen\tstatus');
  let silent = 0;
  for (const r of rows) {
    const risk = [];
    if (!r.has_session) risk.push('no_session');
    if (!Number(r.ai)) risk.push('ai_off');
    if (!r.has_prompt) risk.push('empty_prompt');
    if (risk.length) silent += 1;
    console.log(
      [
        r.id,
        r.phone,
        Number(r.ai),
        Number(r.has_session),
        Number(r.has_prompt),
        r.prompt_len,
        r.status,
        risk.join(',') || 'ok',
      ].join('\t'),
    );
  }
  console.log('---');
  console.log('total', rows.length, 'risk_rows', silent);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
