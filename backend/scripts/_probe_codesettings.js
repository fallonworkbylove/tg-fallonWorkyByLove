const path = require('path');
const root = '/root/opt/tgbot/tg-miniapp-loverussian/backend';
process.chdir(root);
const { Api } = require('telegram');
const cs = Api.CodeSettings;
console.log('CodeSettings', typeof cs);
try {
  const inst = new Api.CodeSettings({
    allowFlashcall: false,
    currentNumber: false,
    allowAppHash: false,
    allowMissedCall: false,
    logoutTokens: [],
  });
  console.log('inst', inst);
  console.log('keys', Object.keys(inst));
} catch (e) {
  console.error('new fail', e.message);
}
// show getCode / sendCode related
const auth = Api.auth;
console.log('auth.SendCode' in auth, !!auth.SendCode);
