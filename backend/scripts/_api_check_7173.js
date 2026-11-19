(async () => {
  const res = await fetch('http://127.0.0.1:3000/api/accounts');
  const j = await res.json();
  const arr = j.accounts || j.data || [];
  const hit = (Array.isArray(arr) ? arr : []).filter(
    (a) =>
      a.id === 2 ||
      String(a.phone || '').includes('7173') ||
      String(a.phone || '').includes('995930'),
  );
  console.log(
    JSON.stringify(
      hit.map((a) => ({
        id: a.id,
        phone: a.phone,
        is_online: a.is_online,
        status: a.status,
        is_autoreply_enabled: a.is_autoreply_enabled,
      })),
      null,
      2,
    ),
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
