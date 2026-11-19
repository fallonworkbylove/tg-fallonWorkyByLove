/**
 * Smoke 0m2 — replyGateRegistry + live cliche postfilter + mac-ship auto parse.
 */
const fs = require('fs');
const path = require('path');

const reg = require(path.join(__dirname, '../services/replyGateRegistry'));
const lite = require(path.join(__dirname, '../services/softHumanLite'));

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
}

// registry waves
{
  const waves = reg.listWaves();
  assert(Array.isArray(waves) && waves.length >= 3, 'listWaves');
  assert(waves.some((w) => w.id === '0m2'), 'wave 0m2 listed');
}

// CLICHE_TRACK + alts (live metrics via source — no mysql require)
{
  const liveSrc = fs.readFileSync(path.join(__dirname, '../services/opsLiveMetrics.js'), 'utf8');
  assert(/CLICHE_TRACK/.test(liveSrc) && /module\.exports[\s\S]*CLICHE_TRACK/.test(liveSrc), 'live export');
  assert(Array.isArray(reg.CLICHE_TRACK) && reg.CLICHE_TRACK.includes('кайф'), 'reg track');
  for (const p of reg.CLICHE_TRACK) {
    assert(Array.isArray(reg.CLICHE_ALTS[p]) && reg.CLICHE_ALTS[p].length > 0, `alts for ${p}`);
  }
}

// overuse rewrite
{
  const hist = [{ role: 'assistant', content: 'кайф)' }];
  const out = reg.fixLiveClicheOveruse('кайф)', hist);
  assert(out && !/^кайф\)?$/i.test(out.trim()), 'kaif rewrite');
  assert(!out.toLowerCase().includes('кайф'), 'kaif gone');
}

{
  const hist = [{ role: 'assistant', content: 'ну ок поняла' }];
  const out = reg.fixLiveClicheOveruse('ну ок', hist);
  assert(out && !/ну ок/i.test(out), 'nu ok rewrite');
}

// no rewrite without history hit
{
  const out = reg.fixLiveClicheOveruse('кайф)', []);
  assert(/кайф/i.test(out), 'no hist keep');
}

// long reply untouched (>90 chars)
{
  const long =
    'кайф) ну вообще да, расскажи ещё про работу и как день прошёл у тебя сегодня, интересно же послушать подробнее';
  assert(long.length > 90, 'fixture long');
  const hist = [{ role: 'assistant', content: 'кайф)' }];
  const out = reg.fixLiveClicheOveruse(long, hist);
  assert(out === long, 'long keep');
}

// softHumanLite wires registry
{
  const src = fs.readFileSync(path.join(__dirname, '../services/softHumanLite.js'), 'utf8');
  assert(/replyGateRegistry/.test(src) && /fixLiveClicheOveruse/.test(src), 'lite wires registry');
  const hist = [{ role: 'assistant', content: 'кайф)' }];
  const out = lite.applySoftLite('кайф)', hist, 'ну как');
  assert(typeof out === 'string' && out.length > 0, 'applySoftLite 0m2');
}

// applyRegisteredGates
{
  const out = reg.applyRegisteredGates('давай встретимся завтра', [], 'давай встретимся');
  assert(/переезд|разъезд|пока\s+тут|после/i.test(out), 'registered soft meet');
}

// mac-ship auto-collect
{
  const ship = fs.readFileSync(path.join(__dirname, '../../scripts/mac-ship.sh'), 'utf8');
  assert(/MAC_SHIP_DEPLOY_SH|MAC_SHIP_NO_AUTO/.test(ship), 'mac-ship auto');
  assert(/\$SRC\/\(\[A-Za-z0-9_/.test(ship) || /finditer.*\$SRC/.test(ship), 'mac-ship parse SRC');
}

// private key gitignored
{
  const gi = fs.readFileSync(path.join(__dirname, '../../.gitignore'), 'utf8');
  assert(/secrets\/ssh\/id_ed25519/.test(gi), 'gitignore private key');
}

console.log('SMOKE_WAVE_0M2_OK');
process.exit(0);
