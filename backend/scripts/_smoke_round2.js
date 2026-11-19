/* eslint-disable no-console */
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'local-smoke-only';
const a = require('../services/aiResponder');
const h = require('../services/humanizeSpeech');

const cases = [
  ['нет, я пока в Липецке, а потом', '', 'ru'],
  ['да, будет ну да)', '', 'ru'],
  ['ага, вот так и живём', '', 'ru'],
  ['да, всё впереди)', '', 'ru'],
  ['ну, стоит глянуть) атмосфера классная', '', 'ru'],
  ['понятно) работаешь много, да', '', 'ru'],
  ['хай)', 'чем занята', 'ru'],
  ['хах, ну да, было бы прикольно', '', 'ru'],
  ['да, именно) ностальгия такая', '', 'ru'],
  ['ладно, держи из того что есть)', 'скинь фото', 'ru'],
  ["Haha, you're sweet", '', 'en'],
  ["Haha, I appreciate the thought, but I'm", '', 'en'],
  ['Not at all, age is just a number', '', 'en'],
  ['ну типо хах ну стараюсь', '', 'ru'],
];

for (const [r, u, lang] of cases) {
  let out = a.fixFakeNostalgia(r);
  out = a.fixDoubleFillerLaugh(out);
  out = a.fixHollowPersonaDump(out, u, lang);
  out = a.fixAuditRoundBugs(out, u, lang);
  out = a.fixLogBugsRound2(out, u, lang);
  console.log(JSON.stringify(r), '=>', JSON.stringify(out));
}
console.log('sechas', JSON.stringify(h.cleanupHumanArtifacts('сечас в Липецке')));
console.log('sechas mid', JSON.stringify(h.cleanupHumanArtifacts('поняла, сечас в Липецке')));
