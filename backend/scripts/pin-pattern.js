// Закрепляет ("пинит") конкретный паттерн ответа бота так, чтобы он ВСЕГДА
// попадал в few-shot подсказку (см. services/learningDb.js), независимо от
// накопленной статистики uses/success_rate.
//
// По умолчанию закрепляет как ХОРОШИЙ эталон (success_rate = 100%):
//   node scripts/pin-pattern.js --reply="не против познакомиться"
//   node scripts/pin-pattern.js --trigger="Дайвинчика" --reply="не против познакомиться"
//
// С флагом --bad закрепляет как ПЛОХОЙ пример (success_rate = 0%) — модель
// всегда увидит его как "никогда так не делай", даже если статистики по
// нему пока мало:
//   node scripts/pin-pattern.js --trigger="Позвони по видео" --reply="давай пока тут общаться" --bad
//
// Если под подстроку подходит несколько записей в bot_patterns — закрепятся
// все они (будь точнее в --trigger/--reply, если нужно закрепить только одну).

require('dotenv').config();
const { pinPattern } = require('../services/learningDb');

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    if (arg === '--bad') {
      args.bad = true;
      continue;
    }
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

async function main() {
  const args = parseArgs();
  const triggerContains = args.trigger || null;
  const replyContains = args.reply || null;
  const bad = Boolean(args.bad);

  if (!triggerContains && !replyContains) {
    console.error('Укажи хотя бы один из параметров: --trigger="..." и/или --reply="..."');
    process.exit(1);
  }

  console.log(
    `[pin-pattern] Ищу паттерны по: ${triggerContains ? `trigger содержит "${triggerContains}"` : ''}${
      triggerContains && replyContains ? ' и ' : ''
    }${replyContains ? `reply содержит "${replyContains}"` : ''} (закрепляю как ${bad ? 'ПЛОХОЙ' : 'хороший'} пример)`,
  );

  const { updated, rows } = await pinPattern({ triggerContains, replyContains, bad });

  if (!updated) {
    console.log('[pin-pattern] Ничего не найдено — проверь подстроку (регистр важен для LIKE в MySQL зависит от collation).');
    process.exit(0);
  }

  console.log(`[pin-pattern] Закреплено ${updated} паттерн(ов), success_rate выставлен в ${bad ? '0' : '100'}%:`);
  for (const r of rows) {
    console.log(`  #${r.id} | "${(r.trigger_msg || '').slice(0, 60)}" -> "${(r.bot_reply || '').slice(0, 60)}"`);
  }
  console.log('[pin-pattern] Готово. Закреплённый пример теперь всегда попадает в подсказку few-shot.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[pin-pattern] Ошибка:', err.message);
  process.exit(1);
});
