/**
 * Отчёт по расходам на OpenAI за последние N дней, с разбивкой по модели.
 * Данные берутся из таблицы openai_usage_log (см. services/finetuneUsage.js).
 *
 * Использование:
 *   node scripts/finetune-cost-report.js --days=7
 */

require('dotenv').config();
const db = require('../db');

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=?(.*)$/);
    if (m) args[m[1]] = m[2] === '' ? true : m[2];
  }
  return args;
}

async function main() {
  const args = parseArgs();
  const days = Number(args.days ?? 7);

  const [byModel] = await db.execute(
    `SELECT
       model,
       COUNT(*) AS requests,
       SUM(prompt_tokens) AS prompt_tokens,
       SUM(completion_tokens) AS completion_tokens,
       SUM(estimated_cost_usd) AS cost_usd,
       SUM(fell_back) AS fallback_count
     FROM openai_usage_log
     WHERE created_at >= (NOW() - INTERVAL ? DAY)
     GROUP BY model
     ORDER BY cost_usd DESC`,
    [days],
  );

  const [byDay] = await db.execute(
    `SELECT
       DATE(created_at) AS day,
       model,
       COUNT(*) AS requests,
       SUM(estimated_cost_usd) AS cost_usd
     FROM openai_usage_log
     WHERE created_at >= (NOW() - INTERVAL ? DAY)
     GROUP BY DATE(created_at), model
     ORDER BY day DESC, cost_usd DESC`,
    [days],
  );

  console.log(`\n=== Расходы OpenAI за последние ${days} дней ===\n`);

  if (byModel.length === 0) {
    console.log('Нет данных — либо бот ещё не логировал usage, либо за этот период не было запросов.');
    process.exit(0);
  }

  let totalCost = 0;
  console.log('По моделям:');
  for (const row of byModel) {
    totalCost += Number(row.cost_usd || 0);
    console.log(
      `  ${row.model.padEnd(40)} запросов: ${String(row.requests).padStart(6)}  ` +
        `токены (in/out): ${row.prompt_tokens}/${row.completion_tokens}  ` +
        `стоимость: $${Number(row.cost_usd).toFixed(4)}` +
        (row.fallback_count > 0 ? `  [фолбэков: ${row.fallback_count}]` : ''),
    );
  }
  console.log(`\nИТОГО: $${totalCost.toFixed(4)}\n`);

  console.log('По дням:');
  let currentDay = null;
  for (const row of byDay) {
    const dayStr = new Date(row.day).toISOString().slice(0, 10);
    if (dayStr !== currentDay) {
      currentDay = dayStr;
      console.log(`  ${dayStr}:`);
    }
    console.log(`    ${row.model.padEnd(38)} $${Number(row.cost_usd).toFixed(4)} (${row.requests} запросов)`);
  }

  const fallbackTotal = byModel.reduce((sum, r) => sum + Number(r.fallback_count || 0), 0);
  if (fallbackTotal > 0) {
    console.log(
      `\nВНИМАНИЕ: было ${fallbackTotal} случаев фолбэка на запасную модель — ` +
        'стоит проверить логи, почему основная (fine-tuned) модель недоступна.',
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('[finetune-cost-report] Ошибка:', err);
  process.exit(1);
});
