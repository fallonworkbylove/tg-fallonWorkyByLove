#!/usr/bin/env node
/**
 * Быстрый TCP-проб через каждый SOCKS из PROXY_LIST до DC Telegram.
 * Печатает рабочие индексы — чтобы login не начинал с мёртвого.
 */
require('dotenv').config();
const net = require('net');
const { SocksClient } = require('socks');

const DEST = { host: '149.154.167.41', port: 443 };
const TIMEOUT = 8000;

function parsePool() {
  return String(process.env.PROXY_LIST || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((raw) => {
      const p = raw.split(':');
      return {
        raw,
        type: p[0],
        host: p[1],
        port: Number(p[2]),
        userId: p[3],
        password: p[4],
      };
    })
    .filter((x) => x.type === 'socks5' && x.host && x.port);
}

async function probeOne(proxy) {
  const started = Date.now();
  try {
    const { socket } = await SocksClient.createConnection({
      proxy: {
        host: proxy.host,
        port: proxy.port,
        type: 5,
        userId: proxy.userId,
        password: proxy.password,
      },
      command: 'connect',
      timeout: TIMEOUT,
      destination: DEST,
    });
    socket.destroy();
    return { ok: true, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, ms: Date.now() - started, err: e.message };
  }
}

(async () => {
  const pool = parsePool();
  console.log('PROBES', pool.length, '→', DEST.host + ':' + DEST.port);
  const ok = [];
  for (let i = 0; i < pool.length; i++) {
    const r = await probeOne(pool[i]);
    console.log(
      r.ok ? 'OK ' : 'FAIL',
      i,
      pool[i].host + ':' + pool[i].port,
      r.ms + 'ms',
      r.err || '',
    );
    if (r.ok) ok.push(i);
  }
  console.log('WORKING_INDEXES', ok.join(',') || '(none)');
  process.exit(ok.length ? 0 : 2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
