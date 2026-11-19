#!/usr/bin/env node
/**
 * Re-probe proxies-dead.txt → TG / OpenAI-only / still dead.
 * Prints machine lines for the shell wrapper.
 */
const fs = require('fs');
const path = require('path');
const { SocksClient } = require('socks');

const cfgDir = process.env.PROXY_CFG_DIR || path.join(__dirname, '..', 'config');
const deadPath = path.join(cfgDir, 'proxies-dead.txt');

const DEST = {
  tg: [
    { host: '149.154.167.51', port: 443 },
    { host: '149.154.175.54', port: 443 },
  ],
  any: [{ host: '1.1.1.1', port: 443 }],
  openai: [{ host: 'api.openai.com', port: 443 }],
};

function readLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function parseLine(line) {
  const p = line.split(':');
  if (p.length < 4) return null;
  return { host: p[0], port: +p[1], userId: p[2], password: p[3], line };
}

async function canConnect(px, destinations, timeout = 8000) {
  for (const destination of destinations) {
    try {
      const info = await SocksClient.createConnection({
        proxy: {
          host: px.host,
          port: px.port,
          type: 5,
          userId: px.userId,
          password: px.password,
        },
        command: 'connect',
        destination,
        timeout,
      });
      try {
        info.socket.destroy();
      } catch (_) {}
      return true;
    } catch (_) {}
  }
  return false;
}

(async () => {
  const raw = readLines(deadPath);
  const list = raw.map(parseLine).filter(Boolean);
  console.log('DEAD_INPUT', list.length, deadPath);

  const tg = [];
  const openai = [];
  const still = [];

  for (const px of list) {
    const okTg = await canConnect(px, DEST.tg);
    let okOa = false;
    let okAny = false;
    if (!okTg) {
      okOa = await canConnect(px, DEST.openai);
      if (!okOa) okAny = await canConnect(px, DEST.any);
    }
    let kind = 'STILL_DEAD';
    if (okTg) {
      kind = 'REVIVED_TG';
      tg.push(px.line);
    } else if (okOa || okAny) {
      kind = 'REVIVED_OPENAI';
      openai.push(px.line);
    } else {
      still.push(px.line);
    }
    console.log(kind, `${px.host}:${px.port}`, `tg=${okTg ? 1 : 0}`, `openai=${okOa ? 1 : 0}`, `https=${okAny ? 1 : 0}`);
  }

  console.log('---');
  console.log('REVIVED_TG_COUNT', tg.length);
  console.log('REVIVED_OPENAI_COUNT', openai.length);
  console.log('STILL_DEAD_COUNT', still.length);
  console.log('TG_LINES');
  for (const l of tg) console.log(l);
  console.log('OPENAI_LINES');
  for (const l of openai) console.log(l);
  console.log('STILL_DEAD_LINES');
  for (const l of still) console.log(l);
})().catch((e) => {
  console.error('FATAL', e && e.message ? e.message : e);
  process.exit(1);
});
