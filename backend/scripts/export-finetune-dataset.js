/**
 * Экспорт датасета для fine-tuning gpt-4o-mini из реальных диалогов бота.
 *
 * Источник примеров — таблица bot_patterns (services/learningDb.js), где уже
 * копится статистика success_rate/uses по каждой уникальной фразе бота и её
 * триггеру. Берём только те пары (триггер -> ответ), которые действительно
 * получили хорошую реакцию собеседника — так в датасет попадает только
 * проверенный на практике стиль, а не случайные ответы.
 *
 * Результат — JSONL в формате OpenAI chat fine-tuning:
 *   {"messages": [{"role": "system", ...}, {"role": "user", ...}, {"role": "assistant", ...}]}
 *
 * Можно также подмешать уже готовый датасет (файл в том же формате JSONL),
 * который есть у пользователя вручную — см. флаг --merge.
 *
 * Использование:
 *   node scripts/export-finetune-dataset.js \
 *     --out=../training-data/finetune-dataset.jsonl \
 *     --min-uses=3 --min-rate=0.7 --limit=2000 \
 *     --system="Ты Вика, 24 года. ..." \
 *     --merge=../training-data/manual-dataset.jsonl
 *
 * Параметры:
 *   --out        путь к результирующему .jsonl (по умолчанию ./finetune-dataset.jsonl)
 *   --min-uses   минимум использований фразы, чтобы считать статистику надёжной (по умолчанию 3)
 *   --min-rate   минимальный success_rate 0..1 (по умолчанию 0.7)
 *   --stage      ограничить одним этапом диалога: early_chat|objection_handling|nft_pitch|general
 *   --limit      максимум примеров из БД (по умолчанию 2000)
 *   --system     системный промпт персонажа, который будет вписан в каждый пример
 *                (если не задан — берётся первый непустой promt из таблицы accounts)
 *   --merge      путь к уже готовому .jsonl с ручными примерами — просто копируется в конец файла
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../db');

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=?(.*)$/);
    if (m) args[m[1]] = m[2] === '' ? true : m[2];
  }
  return args;
}

async function getDefaultSystemPrompt() {
  try {
    const [rows] = await db.execute(
      `SELECT prompt FROM accounts WHERE prompt IS NOT NULL AND prompt <> '' LIMIT 1`,
    );
    return rows[0]?.prompt || null;
  } catch (err) {
    console.warn('[export-finetune-dataset] Не удалось прочитать промпт из accounts:', err.message);
    return null;
  }
}

async function fetchGoodPatterns({ minUses, minRate, stage, limit }) {
  const conditions = ['uses >= ?', 'success_rate >= ?', "trigger_msg IS NOT NULL", "trigger_msg <> ''"];
  const params = [minUses, minRate];
  if (stage) {
    conditions.push('stage = ?');
    params.push(stage);
  }
  // LIMIT нельзя биндить через execute() (подготовленные запросы) — MySQL/MariaDB
  // в некоторых версиях отвечает "Incorrect arguments to mysqld_stmt_execute" на
  // параметризованный LIMIT. Подставляем безопасно провалидированное целое число
  // напрямую в текст запроса (никакого пользовательского ввода здесь нет).
  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.trunc(Number(limit))) : 2000;
  const sql = `
    SELECT trigger_msg, bot_reply, uses, success_rate, stage
    FROM bot_patterns
    WHERE ${conditions.join(' AND ')}
    ORDER BY success_rate DESC, uses DESC
    LIMIT ${safeLimit}
  `;
  const [rows] = await db.execute(sql, params);
  return rows;
}

function toJsonlLine(systemPrompt, triggerMsg, botReply) {
  return JSON.stringify({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: triggerMsg },
      { role: 'assistant', content: botReply },
    ],
  });
}

async function main() {
  const args = parseArgs();
  // Резолвим от текущей рабочей директории (там, откуда запущена команда),
  // а не от папки скрипта — иначе тот же самый "../training-data/..." путь
  // указывает на разные места в export-finetune-dataset.js и
  // finetune-openai.js (последний резолвит от process.cwd()).
  const outPath = path.resolve(process.cwd(), args.out || 'finetune-dataset.jsonl');
  const minUses = Number(args['min-uses'] ?? 3);
  const minRate = Number(args['min-rate'] ?? 0.7);
  const stage = args.stage || null;
  const limit = Number(args.limit ?? 2000);

  const systemPrompt = args.system || (await getDefaultSystemPrompt());
  if (!systemPrompt) {
    console.error(
      '[export-finetune-dataset] Не задан системный промпт: передай --system="..." ' +
        'или убедись, что в таблице accounts есть непустой prompt.',
    );
    process.exit(1);
  }

  console.log(
    `[export-finetune-dataset] Отбираю паттерны: min-uses=${minUses}, min-rate=${minRate}, stage=${stage || 'любой'}, limit=${limit}`,
  );

  const patterns = await fetchGoodPatterns({ minUses, minRate, stage, limit });
  console.log(`[export-finetune-dataset] Найдено подходящих паттернов: ${patterns.length}`);

  if (patterns.length === 0) {
    console.warn(
      '[export-finetune-dataset] Ничего не найдено — либо бот ещё недостаточно поработал, ' +
        'либо снизь --min-uses/--min-rate.',
    );
  }

  const lines = patterns.map((p) => toJsonlLine(systemPrompt, p.trigger_msg, p.bot_reply));

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
  console.log(`[export-finetune-dataset] Записано ${lines.length} примеров из БД в ${outPath}`);

  if (args.merge) {
    const mergePath = path.resolve(process.cwd(), args.merge);
    if (!fs.existsSync(mergePath)) {
      console.error(`[export-finetune-dataset] Файл для merge не найден: ${mergePath}`);
      process.exit(1);
    }
    const manualContent = fs.readFileSync(mergePath, 'utf8').trim();
    const manualLines = manualContent.split('\n').filter(Boolean);
    // Валидация: каждая строка должна быть валидным JSON с полем messages.
    let validCount = 0;
    for (const line of manualLines) {
      try {
        const parsed = JSON.parse(line);
        if (Array.isArray(parsed.messages)) validCount += 1;
      } catch (err) {
        console.warn('[export-finetune-dataset] Пропущена невалидная строка в merge-файле:', err.message);
      }
    }
    fs.appendFileSync(outPath, manualLines.join('\n') + '\n', 'utf8');
    console.log(`[export-finetune-dataset] Добавлено ${validCount}/${manualLines.length} валидных строк из ${mergePath}`);
  }

  const totalLines = fs.readFileSync(outPath, 'utf8').trim().split('\n').filter(Boolean).length;
  console.log(`[export-finetune-dataset] Итого в датасете: ${totalLines} примеров.`);
  if (totalLines < 10) {
    console.warn(
      '[export-finetune-dataset] ВНИМАНИЕ: OpenAI требует минимум 10 примеров для запуска fine-tuning. ' +
        'Для реально заметного эффекта обычно нужно от 50-100 качественных примеров.',
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('[export-finetune-dataset] Ошибка:', err);
  process.exit(1);
});
