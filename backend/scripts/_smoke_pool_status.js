require('dotenv').config();

(async () => {
  const key = String(process.env.TELEGRAM_AUTH_BYPASS_KEY || '').trim();
  const r = await fetch('http://127.0.0.1:3000/api/accounts/pool-status', {
    headers: key ? { 'X-Auth-Bypass-Key': key } : {},
  });
  console.log('status', r.status);
  const j = await r.json();
  if (!j.success) {
    console.log(j);
    process.exit(1);
  }
  console.log('summary', { online: j.online, pingOk: j.pingOk, total: j.total });
  for (const a of j.accounts || []) {
    console.log(
      [
        `id=${a.id}`,
        a.phone,
        `online=${a.is_online}`,
        `ping=${a.ping_ok ? 'ok' : a.ping_reason || 'fail'}`,
        `ai=${a.ai ? 1 : 0}`,
        a.status,
        a.username ? `@${a.username}` : '',
        a.firstName || '',
      ]
        .filter(Boolean)
        .join(' | '),
    );
  }
  const bad = (j.accounts || []).filter((a) => a.has_session && !a.ping_ok);
  if (bad.length) {
    console.log(
      'NOT_OK',
      bad.map((a) => ({ id: a.id, phone: a.phone, reason: a.ping_reason })),
    );
    process.exitCode = 2;
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
