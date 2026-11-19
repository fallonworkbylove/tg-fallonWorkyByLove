/**
 * Persona slim: city cases + unslop (no «Обычная живая», no nominative after «в»).
 */
const path = require('path');
const fs = require('fs');
const scaleOps = require('../services/scaleOps');
const { inCityPrep, inCityAcc } = require('../services/personaFacts');

let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log('OK', name);
  else {
    fail++;
    console.log('FAIL', name, detail);
  }
}

ok('prep_lipetsk', inCityPrep('Липецк') === 'Липецке', inCityPrep('Липецк'));
ok('prep_timashevsk', inCityPrep('Тимашевск') === 'Тимашевске', inCityPrep('Тимашевск'));
ok('prep_ivanovo', inCityPrep('Иваново') === 'Иванове', inCityPrep('Иваново'));
ok('acc_timashevsk', inCityAcc('Тимашевск') === 'Тимашевск', inCityAcc('Тимашевск'));
ok('acc_anapa', inCityAcc('Анапа') === 'Анапу', inCityAcc('Анапа'));

const slimPath = path.join(__dirname, '..', '..', 'prompts', 'persona_slim.txt');
const slim = fs.readFileSync(slimPath, 'utf8');
ok('has_FROM_CITY_IN', /FROM_CITY_IN/.test(slim));
ok('has_TO_CITY_ACC', /TO_CITY_ACC/.test(slim));
ok('has_TO_CITY_IN', /TO_CITY_IN/.test(slim));
ok('no_cliche_obychnaya', !/Обычная живая девушка/i.test(slim));
ok('no_not_role', !/Ты не роль/i.test(slim));

const filled = scaleOps.fillPersonaTemplate(slim, {
  name: 'Вика',
  age: '26',
  fromCity: 'Липецк',
  toCity: 'Тимашевск',
});
ok('filled_live_in', /живёшь в Липецке/.test(filled), filled.slice(0, 120));
ok('filled_move_to', /переезжаешь в Тимашевск/.test(filled), filled.slice(0, 160));
ok('filled_mom_in', /Мама уже в Тимашевске/.test(filled), filled.slice(0, 200));
ok('filled_still_in', /ты ещё в Липецке/.test(filled), filled.slice(0, 200));
ok('no_live_nominative', !/живёшь в Липецк[,\s]/.test(filled), filled.slice(0, 120));

const tmpl = (scaleOps.PERSONA_TEMPLATES || []).find((t) => t.id === 'vika_timashevsk');
ok('template_vika', !!tmpl);
if (tmpl) {
  ok('vika_prompt_case', /в Липецке/.test(tmpl.prompt) && /в Тимашевске/.test(tmpl.prompt), tmpl.prompt.slice(0, 180));
}

if (fail) {
  console.log('FAIL_TOTAL', fail);
  process.exit(1);
}
console.log('ALL_OK');
process.exit(0);
