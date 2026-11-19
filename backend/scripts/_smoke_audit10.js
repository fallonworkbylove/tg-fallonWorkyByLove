require('dotenv').config();
const fs = require('fs');

(async () => {
  const noHdr = await fetch('http://127.0.0.1:3000/api/accounts');
  console.log('no_header_status', noHdr.status);

  const key = String(process.env.TELEGRAM_AUTH_BYPASS_KEY || '').trim();
  const withKey = await fetch('http://127.0.0.1:3000/api/accounts', {
    headers: key ? { 'X-Auth-Bypass-Key': key } : {},
  });
  console.log('with_key_or_loopback', withKey.status);
  const j = await withKey.json();
  const accounts = j.accounts || [];
  console.log(
    'phones',
    accounts.map((a) => a.phone),
  );
  console.log(
    '7173',
    accounts
      .filter((a) => String(a.phone).includes('7173'))
      .map((a) => ({
        id: a.id,
        phone: a.phone,
        online: a.is_online,
        status: a.status,
        promptLen: (a.prompt || '').length,
      })),
  );
  const nonE164 = accounts.filter((a) => /[\s-]/.test(a.phone || ''));
  console.log('non_e164_count', nonE164.length, nonE164.map((a) => a.phone));

  if (accounts[0]) {
    const ping = await fetch(`http://127.0.0.1:3000/api/accounts/${accounts[0].id}/session-ping`, {
      headers: key ? { 'X-Auth-Bypass-Key': key } : {},
    });
    console.log('session_ping', ping.status, await ping.text());
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
