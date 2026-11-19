require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const [rows] = await c.query(`
    SELECT account_id, peer_username, role, content, created_at
    FROM conversation_messages
    WHERE created_at > NOW() - INTERVAL 12 HOUR
    ORDER BY id DESC LIMIT 600`);
  rows.reverse();
  const pairs = [];
  for (let i = 1; i < rows.length; i += 1) {
    const p = rows[i - 1];
    const a = rows[i];
    if (p.role !== 'user' || a.role !== 'assistant') continue;
    if (p.account_id !== a.account_id || p.peer_username !== a.peer_username) continue;
    const u = String(p.content || '').replace(/\s+/g, ' ').trim();
    const b = String(a.content || '').replace(/\s+/g, ' ').trim();
    if (u.length < 2 || b.length < 2) continue;
    if (/^\[реакция|^<<REACT/i.test(b)) continue;
    pairs.push({ peer: a.peer_username || '?', u: u.slice(0, 200), a: b.slice(0, 200) });
  }
  const seen = new Set();
  const out = [];
  for (const x of pairs.reverse()) {
    const k = x.a.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
    if (out.length >= 60) break;
  }
  out.reverse();

  const rules = [
    [/просто\s+общение|ничего\s+конкретного|интересных\s+людей/i, 'seeking'],
    [/цифров[а-яё]*\s+актив|типа\s+криптовалют/i, 'crypto-wiki'],
    [/всегда\s+(?:норм|удобн|хорош|полезн)|полезн[а-яё]*\s+штук|новый\s+этап|мечты\s*[-—]\s*это/i, 'corporate'],
    [/связь\s+восстанов/i, 'meta'],
    [/напомни|не\s+очень\s+выгляжу|завтра[,\s]+(?:я\s+)?сделаю/i, 'defer-photo'],
    [/редко\s+кто\s+пишет/i, 'lonely'],
    [/^(?:поняла|спасиб[оа]?|спс|ага|ок|нормально|хорошо|да)\s*\)*\.?$/i, 'bare'],
    [/главное[,\s]+(?:что|што)|это\s+самое\s+приятное|особенно\s+с\s+чашечк/i, 'soft-platitude'],
    [/удачной\s+прогулки|приятного\s+аппетита|хорошего\s+дня|хороших\s+выходных/i, 'formal-wish'],
    [/стараюсь\s+быть\s+разной|поддерживать\s+форму/i, 'try-hard'],
    [/если\s+што,?\s+я\s+здесь|я\s+здесь\s*\)*$/i, 'support-bot'],
    [/^(?:да,?\s+)?согласна\s*\)*$/i, 'agree-bot'],
    [/классно,?\s+что|здорово,?\s+что|отлично,?\s+что/i, 'meta-cheer'],
    [/верю,?\s+верю|хах,?\s+верю/i, 'echo-believe'],
    [/немнго|прсто|што\b/i, 'typo-leak'],
  ];

  console.log('=== HEURISTIC BAD ===');
  let badN = 0;
  for (const x of out) {
    const hits = [];
    for (const [re, name] of rules) {
      if (re.test(x.a)) hits.push(name);
    }
    if (/\?\s*\)*$/.test(x.a)) hits.push('trailing-q');
    if (!hits.length) continue;
    badN += 1;
    console.log(`[${hits.join(',')}] ${x.peer}`);
    console.log(`  ОН: ${x.u.slice(0, 110)}`);
    console.log(`  ОНА: ${x.a}`);
  }
  console.log(`\nbad=${badN}/${out.length}`);
  console.log('\n=== LATEST 25 ===');
  for (const x of out.slice(-25)) {
    console.log(`--- ${x.peer}`);
    console.log(`ОН: ${x.u}`);
    console.log(`ОНА: ${x.a}`);
  }
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
