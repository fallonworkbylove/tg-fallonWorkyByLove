require('dotenv').config({ quiet: true });
const { socksDispatcher } = require('fetch-socks');

async function probe(entry) {
  const p = entry.split(':').map((s) => s.trim());
  if (!/^socks/.test(p[0] || '')) return null;
  const cfg = {
    type: 5,
    host: p[1],
    port: Number(p[2]),
    userId: p[3],
    password: p[4],
  };
  try {
    const d = socksDispatcher(cfg);
    const r = await fetch('https://api.openai.com/v1/models', {
      dispatcher: d,
      signal: AbortSignal.timeout(10000),
      headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
    });
    return { host: cfg.host, status: r.status, ok: r.status < 500 };
  } catch (e) {
    return { host: cfg.host, ok: false, err: (e.cause && e.cause.code) || e.message };
  }
}

(async () => {
  const raw = process.env.PROXY_LIST || '';
  const entries = raw.split(';').map((s) => s.trim()).filter(Boolean).slice(0, 10);
  for (const e of entries) {
    const r = await probe(e);
    if (r) console.log(JSON.stringify(r));
  }
})();
