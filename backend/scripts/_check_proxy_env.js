#!/usr/bin/env node
require('dotenv').config();
const list = String(process.env.PROXY_LIST || '')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);
console.log('PROXY_COUNT', list.length);
list.forEach((raw, i) => {
  const parts = raw.split(':');
  console.log(i, parts[0], parts[1], parts[2]);
});
