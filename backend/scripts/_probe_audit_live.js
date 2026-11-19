const db = require('../db');
(async () => {
  const [cols] = await db.execute('SHOW COLUMNS FROM accounts');
  const fields = cols.map((c) => c.Field);
  console.log('acc_cols', fields.join(','));
  const pick = ['id', 'phone', 'name', 'username', 'ai_enabled', 'status', 'is_active']
    .filter((f) => fields.includes(f));
  const [a] = await db.execute(
    `SELECT ${pick.join(',')} FROM accounts ORDER BY id DESC LIMIT 15`,
  );
  console.log('accounts', a.length);
  for (const r of a) console.log(JSON.stringify(r));
  const [m] = await db.execute(
    'SELECT COUNT(*) AS c FROM conversation_messages WHERE created_at > NOW() - INTERVAL 30 MINUTE',
  );
  console.log('msgs_30m', m[0].c);
  const [recent] = await db.execute(
    `SELECT role, LEFT(content,120) AS c, created_at FROM conversation_messages
     WHERE role='assistant' AND created_at > NOW() - INTERVAL 20 MINUTE
     ORDER BY id DESC LIMIT 20`,
  );
  console.log('recent_asst', recent.length);
  for (const r of recent) console.log(r.created_at, r.c);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
