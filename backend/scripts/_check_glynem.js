#!/usr/bin/env node
'use strict';
require('dotenv').config();
const db = require('../db');

(async () => {
  const [left] = await db.execute(
    `SELECT id, phone
     FROM accounts
     WHERE prompt LIKE '%глянем%'
        OR prompt LIKE '%вместе посмотрим%'
     LIMIT 30`,
  );
  console.log('remaining with glynem/посмотрим:', left.length);
  for (const r of left) console.log(' ', r.id, r.phone);

  const [sample] = await db.execute(
    `SELECT id, phone,
            CASE WHEN prompt LIKE '%присматриваю%' THEN 1 ELSE 0 END AS has_pitch,
            CASE WHEN prompt LIKE '%глянем%' THEN 1 ELSE 0 END AS has_glynem,
            CASE WHEN prompt LIKE '%вместе посмотрим%' THEN 1 ELSE 0 END AS has_posmotrim
     FROM accounts
     WHERE prompt LIKE '%залетела на платформу%'
     LIMIT 10`,
  );
  console.log('pitch samples:', JSON.stringify(sample, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
