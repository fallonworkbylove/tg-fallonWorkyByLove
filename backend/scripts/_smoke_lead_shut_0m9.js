/**
 * Smoke 0m9 — не отшивать лида / 😔 / фрагмент-эхо / тся→ться.
 */
const path = require('path');
const gates = require(path.join(__dirname, '../services/softHumanGates'));
const lite = require(path.join(__dirname, '../services/softHumanLite'));

function assert(c, m) {
  if (!c) {
    console.error('FAIL', m);
    process.exit(1);
  }
}

// hard shut
{
  const out = gates.fixLeadShutDown('Мы не сможем :)', [], 'надеюсь, что сможем найти общий язык');
  assert(out && !/не\s+сможем/i.test(out), 'rewrite не сможем');
}
{
  const out = gates.fixLeadShutDown('Никак', [], 'мне просто интересно с тобой общаться');
  assert(out && !/^никак/i.test(out.trim()), 'rewrite никак');
}
{
  const out = gates.fixLeadShutDown('Извини', [], 'ты мне нравишься');
  assert(out && !/^извини/i.test(out.trim()), 'rewrite извини on warm');
}

// sad spam
{
  const hist = [{ role: 'assistant', content: '😔' }];
  const out = gates.fixSadEmojiSpam('😔', hist);
  assert(out && !/😔/.test(out), 'sad spam rewrite');
}
{
  const hist = [{ role: 'assistant', content: '😔' }];
  const out = gates.fixSadEmojiSpam('😔👈', hist);
  assert(out && !/😔/.test(out), 'sad point rewrite');
}

// fragment echo
{
  const u = 'из архивов скрытых всегда можно достать что-то интересное)';
  const out = gates.fixFragmentEcho('Из архивов\nСкрытых\nПрошу', u);
  assert(out && !/Из архивов/i.test(out), 'fragment echo rewrite');
}

// тся → ться
{
  const out = gates.fixTsyaInfinitive('Будем знакомится архивами и скрытыми');
  assert(/знакомиться/i.test(out) && !/знакомится/i.test(out), 'ться');
}

// softLite path
{
  const out = lite.applySoftLite('Мы не сможем :)', [], 'надеюсь найти общий язык');
  assert(typeof out === 'string' && out.length > 0 && !/не\s+сможем/i.test(out), 'softLite shut');
}
{
  const out = lite.applySoftLite('Будем знакомится', [], 'давай');
  assert(/знакомиться/i.test(out), 'softLite ться');
}

assert(typeof gates.applyWave0m9Gates === 'function', 'wave export');
console.log('SMOKE_LEAD_SHUT_0M9_OK');
process.exit(0);
