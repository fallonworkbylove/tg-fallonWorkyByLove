require('dotenv').config();

(async () => {
  const key = String(process.env.TELEGRAM_AUTH_BYPASS_KEY || '').trim();
  const h = key ? { 'X-Auth-Bypass-Key': key } : {};
  const r = await fetch('http://127.0.0.1:3000/api/accounts', { headers: h });
  console.log('list_status', r.status);
  const j = await r.json();
  const accounts = j.accounts || [];
  console.log('accounts_total', accounts.length);

  let online = 0;
  let pingOk = 0;
  let pingFail = 0;

  for (const a of accounts) {
    const ping = await fetch(`http://127.0.0.1:3000/api/accounts/${a.id}/session-ping`, {
      headers: h,
    });
    const body = await ping.text();
    let detail = body.slice(0, 120);
    let ok = false;
    try {
      const p = JSON.parse(body);
      ok = !!p.ok;
      detail = ok
        ? `${p.phone || ''} @${p.username || ''} ${p.firstName || ''}`.trim()
        : String(p.reason || 'fail');
    } catch (_) {
      /* raw */
    }
    if (a.is_online) online += 1;
    if (ok) pingOk += 1;
    else pingFail += 1;
    console.log(
      [
        `id=${a.id}`,
        a.phone,
        `list_online=${!!a.is_online}`,
        `status=${a.status || ''}`,
        `ai=${Number(a.is_autoreply_enabled) === 1 ? 1 : 0}`,
        `ping=${ok ? 'ok' : 'FAIL'}`,
        detail,
      ].join(' | '),
    );
  }

  console.log('summary', { online, pingOk, pingFail, total: accounts.length });
  if (pingFail > 0) process.exitCode = 2;
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
