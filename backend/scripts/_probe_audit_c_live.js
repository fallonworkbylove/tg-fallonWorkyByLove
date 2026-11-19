const soft = require('../services/softHumanLite');
const m = 'При-вет\u{1F596}\uFE0F';
const out = soft.applySoftLite('мм, поняла)', [], m);
const q = soft.applySoftLite('эм, сейчас дома, жду посылку))', [], '?');
const bot = soft.applySoftLite('хах, ну ок) просто я не бот, а Лер)', [], 'Чел, у тебя бот поплыл');
console.log(
  JSON.stringify(
    {
      norm: soft.normalizeBareUserText(m),
      bare: soft.isBareGreeting(m),
      greetFix: out,
      bareQ: q,
      botCall: bot,
    },
    null,
    0,
  ),
);
