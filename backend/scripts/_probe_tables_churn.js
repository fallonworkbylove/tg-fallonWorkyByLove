const db = require('../db');
(async () => {
  const [tables] = await db.execute('SHOW TABLES');
  const names = tables.map((r) => Object.values(r)[0]);
  console.log(
    'tables_hit',
    names.filter((n) => /peer|conv|pattern|message|chat|lead|dialog|archiv/i.test(n)).join(', '),
  );
  for (const t of ['bot_patterns', 'pending_reactions_v2', 'messages', 'conversations', 'leads']) {
    if (!names.includes(t)) {
      console.log('missing', t);
      continue;
    }
    const [c] = await db.execute(`SHOW COLUMNS FROM ${t}`);
    console.log(t, c.map((x) => x.Field).join(','));
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
