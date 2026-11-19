#!/usr/bin/env node
/**
 * Модель не должна сливать `[медиа:#id]` текстом в чат.
 */
const path = require('path');
// telegramClient тянет многое — тестируем через require после лёгкого stub env
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'local-smoke-only';
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const tg = require('../services/telegramClient');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else console.log('ok', msg);
}

const leaked = '[медиа:#222] {кружок: Устраиваюсь на диване) ну а у тебя как?}';
const a = tg.extractMediaRequest(leaked);
assert(a.mediaType === 'circle', 'type from leak: ' + a.mediaType);
assert(!/\[медиа:|\{кружок/i.test(a.text), 'no tag in text: ' + JSON.stringify(a.text));
// Описание внутри {кружок:…} намеренно не пускаем в чат — только тип.

const withTok = '<<CIRCLE>> [медиа:#99] {кружок: дома)} привет';
const b = tg.extractMediaRequest(withTok);
assert(b.mediaType === 'circle', 'token+leak type');
assert(!/\[медиа:|<<CIRCLE>>|\{кружок/i.test(b.text), 'clean: ' + b.text);
assert(/привет/i.test(b.text), 'body ok: ' + b.text);

const plain = '<<PHOTO>> лови)';
const c = tg.extractMediaRequest(plain);
assert(c.mediaType === 'photo' && c.text === 'лови)', 'plain token: ' + JSON.stringify(c));

const strip = tg.stripLeakedMediaHistoryTag
  ? tg.stripLeakedMediaHistoryTag(leaked)
  : null;
if (strip) {
  assert(!/\[медиа:/i.test(strip.text), 'strip helper');
}

const fakeTicket = '[отправила фото билета] вот, держи';
const d = tg.extractMediaRequest(fakeTicket);
assert(d.mediaType === 'photo', 'fake ticket → photo: ' + d.mediaType);
assert(!/\[|отправила фото/i.test(d.text), 'no fake tag: ' + d.text);
assert(/вот,\s*держи/i.test(d.text), 'keeps caption: ' + d.text);

const shortTag = 'короче вот, держи) [фото билета] как тебе?';
const e = tg.extractMediaRequest(shortTag);
assert(e.mediaType === 'photo', 'short tag photo');
assert(!/\[фото/i.test(e.text), 'stripped short: ' + e.text);

const youSent =
  '[ты отправила фото: Сижу на диване с чашкой кофе, смотрю в окно и наслаждаюсь атмосферой. (в помещении)] для тебя)';
const f = tg.extractMediaRequest(youSent);
assert(f.mediaType === 'photo', 'ты отправила → photo: ' + f.mediaType);
assert(!/ты отправила|Сижу на диване/i.test(f.text), 'no history echo: ' + f.text);
assert(/для тебя/i.test(f.text), 'keeps caption: ' + f.text);

const earlierGone = '(раньше ушло медиа - это не писать в чат)';
const g = tg.stripLeakedMediaHistoryTag(earlierGone);
assert(!/раньше ушло|не писать/i.test(g.text), 'strip earlier-gone: ' + JSON.stringify(g.text));
assert(!!g.leakedType, 'earlier-gone leakedType');

const earlierMix = '(раньше ушло медиа - это не писать в чат) не, сейчас не могу';
const h = tg.stripLeakedMediaHistoryTag(earlierMix);
assert(!/раньше ушло|не писать/i.test(h.text), 'strip mix meta');
assert(/не,\s*сейчас не могу/i.test(h.text), 'keeps live: ' + h.text);

console.log('MEDIA_TAG_LEAK', process.exitCode ? 'FAIL' : 'OK');
process.exit(process.exitCode || 0);
