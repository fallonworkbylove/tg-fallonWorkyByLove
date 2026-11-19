#!/usr/bin/env node
/**
 * Probe fixed NEW26 list: TG DC / OpenAI / dead → write three notebooks.
 */
const fs = require('fs');
const path = require('path');
const { SocksClient } = require('socks');

const RAW = `
196.18.15.43:8000:nP0X1s:Az3oHJ
196.18.13.49:8000:nP0X1s:Az3oHJ
196.18.14.199:8000:nP0X1s:Az3oHJ
196.18.15.184:8000:nP0X1s:Az3oHJ
196.18.13.165:8000:nP0X1s:Az3oHJ
196.18.14.240:8000:nP0X1s:Az3oHJ
77.83.187.55:8000:jmS9mw:wHVWaT
77.83.185.62:8000:jmS9mw:wHVWaT
77.83.184.49:8000:jmS9mw:wHVWaT
77.83.185.6:8000:jmS9mw:wHVWaT
77.83.185.226:8000:jmS9mw:wHVWaT
77.83.187.2:8000:jmS9mw:wHVWaT
77.83.187.51:8000:jmS9mw:wHVWaT
77.83.185.192:8000:jmS9mw:wHVWaT
77.83.184.6:8000:jmS9mw:wHVWaT
77.83.184.186:8000:jmS9mw:wHVWaT
45.130.61.146:8000:EppBzq:Ggr8Nr
45.130.62.148:8000:EppBzq:Ggr8Nr
161.0.14.85:8000:EppBzq:Ggr8Nr
161.0.14.248:8000:EppBzq:Ggr8Nr
161.0.14.48:8000:EppBzq:Ggr8Nr
192.166.153.231:8000:odffdd:xRee6d
192.166.153.185:8000:odffdd:xRee6d
192.166.153.41:8000:odffdd:xRee6d
45.130.124.29:8000:odffdd:xRee6d
45.130.124.69:8000:odffdd:xRee6d
`.trim();

const list = RAW.split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean)
  .map((line) => {
    const [host, port, userId, password] = line.split(':');
    return { host, port: +port, userId, password, line };
  });

const DEST = {
  tg: [
    { host: '149.154.167.51', port: 443 },
    { host: '149.154.175.54', port: 443 },
  ],
  any: [{ host: '1.1.1.1', port: 443 }],
  openai: [{ host: 'api.openai.com', port: 443 }],
};

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
  const tgOk = [];
  const openaiOnly = [];
  const dead = [];

  for (const px of list) {
    const tg = await canConnect(px, DEST.tg);
    let openai = false;
    let any = false;
    if (!tg) {
      openai = await canConnect(px, DEST.openai);
      if (!openai) any = await canConnect(px, DEST.any);
    }
    let kind = 'DEAD';
    if (tg) {
      kind = 'TG_OK';
      tgOk.push(px.line);
    } else if (openai || any) {
      kind = 'OPENAI_OK';
      openaiOnly.push(px.line);
    } else {
      dead.push(px.line);
    }
    console.log(
      kind,
      `${px.host}:${px.port}`,
      `tg=${tg ? 1 : 0}`,
      `openai=${openai ? 1 : 0}`,
      `https=${any ? 1 : 0}`,
    );
  }

  const outDir = process.env.OUT_DIR || path.join(__dirname, '..', 'config');
  fs.mkdirSync(outDir, { recursive: true });

  const hdr = (title) =>
    `# ${title}\n# probed ${new Date().toISOString()} NEW26 NL-DE-FI\n# host:port:user:pass\n`;

  const tgPath = path.join(outDir, 'proxies-tg-ok.txt');
  const oaPath = path.join(outDir, 'proxies-openai-ok.txt');
  const deadPath = path.join(outDir, 'proxies-dead.txt');

  // merge by host: keep previous lines for other hosts, replace/add NEW26 results
  function mergeNotebook(filePath, header, newLines, dropHosts) {
    const prev = fs.existsSync(filePath)
      ? fs
          .readFileSync(filePath, 'utf8')
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#'))
      : [];
    const kept = prev.filter((l) => {
      const host = l.split(':')[0];
      return !dropHosts.has(host);
    });
    const all = [...kept, ...newLines];
    const seen = new Set();
    const uniq = [];
    for (const l of all) {
      const h = l.split(':')[0];
      if (seen.has(h)) continue;
      seen.add(h);
      uniq.push(l);
    }
    fs.writeFileSync(filePath, header + uniq.join('\n') + (uniq.length ? '\n' : ''), 'utf8');
    return uniq.length;
  }

  const newHosts = new Set(list.map((p) => p.host));
  // each host goes to exactly one notebook among the three
  const nTg = mergeNotebook(tgPath, hdr('TG alive (socks → Telegram DC)'), tgOk, newHosts);
  // for openai notebook: drop newHosts that landed in TG or dead from openai file
  const nOa = mergeNotebook(
    oaPath,
    hdr('OpenAI/HTTPS alive but NOT Telegram'),
    openaiOnly,
    newHosts,
  );
  // also strip TG-ok hosts from openai notebook (safety)
  {
    const tgHosts = new Set(tgOk.map((l) => l.split(':')[0]));
    if (fs.existsSync(oaPath)) {
      const lines = fs
        .readFileSync(oaPath, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));
      const cleaned = lines.filter((l) => !tgHosts.has(l.split(':')[0]));
      fs.writeFileSync(
        oaPath,
        hdr('OpenAI/HTTPS alive but NOT Telegram') + cleaned.join('\n') + (cleaned.length ? '\n' : ''),
        'utf8',
      );
    }
  }
  const nDead = mergeNotebook(deadPath, hdr('Dead everywhere'), dead, newHosts);

  console.log('---');
  console.log('NEW26_TOTAL', list.length);
  console.log('NEW_TG_OK', tgOk.length);
  console.log('NEW_OPENAI_ONLY', openaiOnly.length);
  console.log('NEW_DEAD', dead.length);
  console.log('NOTEBOOK_TG', nTg, tgPath);
  console.log('NOTEBOOK_OPENAI', fs.existsSync(oaPath) ? fs.readFileSync(oaPath, 'utf8').split(/\n/).filter((l) => l && !l.startsWith('#')).length : 0, oaPath);
  console.log('NOTEBOOK_DEAD', nDead, deadPath);
  console.log('TG_LINES');
  for (const l of tgOk) console.log(l);
  console.log('OPENAI_LINES');
  for (const l of openaiOnly) console.log(l);
  console.log('DEAD_LINES');
  for (const l of dead) console.log(l);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
