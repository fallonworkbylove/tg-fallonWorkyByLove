/* probe: does require path throw? */
process.chdir('/root/opt/tgbot/tg-miniapp-loverussian/backend');
require('dotenv').config();
try {
  require('./services/telegramClient');
  console.log('telegramClient ok');
} catch (e) {
  console.error('FAIL', e.message);
  console.error(e.stack);
}
try {
  const a = require('./services/aiResponder');
  console.log('aiResponder ok', typeof a.generateReply, typeof a.fixRecruitAccusation);
} catch (e) {
  console.error('AI FAIL', e.message);
}
