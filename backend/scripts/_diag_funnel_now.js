require('dotenv').config();
const db = require('../db');
const lead = require('../services/leadScoring');

(async () => {
  const [users] = await db.execute(
    `SELECT id, username FROM users
     WHERE username IN ('fallonsociapat','cchischik','idiottpk','milaliori','Wiolova')
        OR telegram_user_id = '8588744561'
     LIMIT 10`,
  );
  for (const u of users) {
    const r = await lead.listScoredConversations(u.id, { sort: 'funnel', limit: 500 });
    console.log(`@${u.username || u.id}`, r.funnel, 'listed=', r.conversations.length);
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
