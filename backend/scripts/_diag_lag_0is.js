#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const db = require('../db');

(async () => {
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  }

  const [rows] = await db.execute(
    `SELECT id, phone, name, reply_delay_min, reply_delay_max, is_autoreply_enabled
     FROM accounts WHERE is_autoreply_enabled=1 ORDER BY id`,
  );
  console.log('=== delays ===');
  for (const r of rows) {
    console.log(
      r.id,
      r.phone,
      'min',
      r.reply_delay_min,
      'max',
      r.reply_delay_max,
      (r.name || '').slice(0, 24),
    );
  }

  const [load] = await db.execute(
    `SELECT account_id, COUNT(*) c FROM chat_logs
     WHERE role='assistant' AND created_at > NOW() - INTERVAL 1 HOUR
       AND content NOT LIKE '[медиа:%' AND content NOT LIKE '[реакция:%'
     GROUP BY account_id ORDER BY c DESC LIMIT 20`,
  );
  console.log('=== hour_load ===');
  for (const r of load) console.log(r.account_id, r.c);

  // openai latency
  const pl = (process.env.OPENAI_PROXY_LIST || process.env.PROXY_LIST || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)[0];
  const key = process.env.OPENAI_API_KEY;
  const t0 = Date.now();
  try {
    const OpenAI = require('openai');
    const { SocksProxyAgent } = require('socks-proxy-agent');
    let agent;
    if (pl) {
      const raw = pl.replace(/^socks5:\/\//i, '').replace(/^socks5:/i, '');
      const [h, p, u, pw] = raw.split(':');
      agent = new SocksProxyAgent(
        `socks5://${encodeURIComponent(u)}:${encodeURIComponent(pw)}@${h}:${p}`,
      );
    }
    const client = new OpenAI({
      apiKey: key,
      httpAgent: agent,
      httpsAgent: agent,
      timeout: 25000,
    });
    const r = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'ок' }],
      max_tokens: 3,
    });
    console.log(
      'openai_ms',
      Date.now() - t0,
      'txt',
      (r.choices[0].message.content || '').slice(0, 30),
      'via',
      pl ? pl.split(':').slice(0, 3).join(':') : 'direct',
    );
  } catch (e) {
    console.log('openai_fail_ms', Date.now() - t0, String(e.message || e).slice(0, 180));
  }

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
