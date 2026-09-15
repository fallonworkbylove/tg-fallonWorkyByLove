#!/usr/bin/env node
/**
 * Загрузка датасета и запуск fine-tuning gpt-4o-mini через OpenAI API.
 *
 * Node.js-версия — использует тот же пакет `openai`, что и сам бот
 * (services/aiResponder.js), поэтому не требует Python/pip: весь пайплайн
 * fine-tuning остаётся на одном языке с проектом.
 *
 * Датасет готовится отдельно (см. export-finetune-dataset.js) — этот скрипт
 * только загружает уже готовый .jsonl файл, создаёт задание на обучение и
 * следит за его статусом до завершения.
 *
 * Использование:
 *   cd backend
 *   node scripts/finetune-openai.js \
 *     --file=../training-data/finetune-dataset.jsonl \
 *     --base-model=gpt-4o-mini-2024-07-18 \
 *     --suffix=vika-v1
 *
 * По завершении скрипт печатает готовый model id вида:
 *   ft:gpt-4o-mini-2024-07-18:org::abc123
 *
 * Этот id нужно вписать в OPENAI_MODEL в .env бота (см. docs/FINE_TUNING.md).
 *
 * Флаги:
 *   --file          путь к .jsonl датасету (обязателен)
 *   --base-model    базовая модель (по умолчанию gpt-4o-mini-2024-07-18)
 *   --suffix        короткий суффикс для имени модели (напр. "vika-v1")
 *   --poll-seconds  интервал опроса статуса задания (по умолчанию 30)
 *   --no-wait       не ждать завершения — только создать задание и вывести job_id
 *   --check=JOB_ID  не создавать новое задание — только проверить статус существующего
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=?(.*)$/);
    if (m) args[m[1]] = m[2] === '' ? true : m[2];
  }
  return args;
}

function buildClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('Ошибка: OPENAI_API_KEY не задан ни в .env, ни в окружении.');
    process.exit(1);
  }
  const baseURL = process.env.OPENAI_BASE_URL || undefined;
  // ВАЖНО: если бот работает через SOCKS5-прокси (см. aiResponder.js,
  // api.openai.com блокирует российские IP) — на машине, где запускается
  // ЭТОТ скрипт, тоже нужен доступ к api.openai.com. Проще всего гонять
  // fine-tuning с сервера/машины с прямым доступом (например, через VPN),
  // либо задать HTTPS_PROXY/ALL_PROXY перед запуском — пакет `openai`
  // сам их не подхватывает, поэтому при необходимости используйте
  // `httpAgent` (см. aiResponder.js) через переменную OPENAI_PROXY_URL.
  const kwargs = { apiKey };
  if (baseURL) {
    kwargs.baseURL = baseURL;
    console.log(`[finetune] Базовый URL переопределён: ${baseURL}`);
  }
  if (process.env.OPENAI_PROXY_URL) {
    const { SocksProxyAgent } = require('socks-proxy-agent');
    kwargs.httpAgent = new SocksProxyAgent(process.env.OPENAI_PROXY_URL);
    console.log('[finetune] Использую SOCKS5-прокси из OPENAI_PROXY_URL.');
  }
  return new OpenAI(kwargs);
}

/** Быстрая локальная проверка формата перед отправкой — экономит время и
 * деньги на случай кривого датасета. */
function validateJsonl(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter((l) => l.trim() !== '');
  let count = 0;
  lines.forEach((line, idx) => {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      console.error(`[error] Строка ${idx + 1}: невалидный JSON — ${e.message}`);
      process.exit(1);
    }
    const messages = obj.messages;
    if (!Array.isArray(messages) || messages.length < 2) {
      console.error(`[error] Строка ${idx + 1}: поле 'messages' должно быть списком минимум из 2 сообщений`);
      process.exit(1);
    }
    const roles = messages.map((m) => m.role);
    if (!roles.includes('assistant')) {
      console.error(`[error] Строка ${idx + 1}: в примере нет сообщения с role='assistant'`);
      process.exit(1);
    }
    count += 1;
  });
  if (count < 10) {
    console.error(`[error] В датасете ${count} примеров — OpenAI требует минимум 10 для запуска fine-tuning.`);
    process.exit(1);
  }
  console.log(`[finetune] Локальная проверка пройдена: ${count} валидных примеров.`);
  return count;
}

async function uploadFile(client, filePath) {
  console.log(`[finetune] Загружаю файл ${filePath} ...`);
  const uploaded = await client.files.create({
    file: fs.createReadStream(filePath),
    purpose: 'fine-tune',
  });
  console.log(`[finetune] Файл загружен, file_id = ${uploaded.id}`);
  return uploaded.id;
}

async function createJob(client, fileId, baseModel, suffix) {
  const payload = { training_file: fileId, model: baseModel };
  if (suffix) payload.suffix = suffix;
  const job = await client.fineTuning.jobs.create(payload);
  console.log(`[finetune] Задание создано: job_id = ${job.id}, статус = ${job.status}`);
  return job.id;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Опрашивает статус задания до финального состояния (succeeded/failed/cancelled). */
async function pollJob(client, jobId, pollSeconds) {
  const terminalStates = new Set(['succeeded', 'failed', 'cancelled']);
  while (true) {
    const job = await client.fineTuning.jobs.retrieve(jobId);
    console.log(`[finetune] Статус: ${job.status} (обновлено ${new Date().toLocaleTimeString()})`);

    try {
      const events = await client.fineTuning.jobs.listEvents(jobId, { limit: 3 });
      [...events.data].reverse().forEach((ev) => console.log(`    · ${ev.message}`));
    } catch {
      // не критично — просто пропускаем вывод событий
    }

    if (terminalStates.has(job.status)) return job;
    await sleep(pollSeconds * 1000);
  }
}

async function main() {
  const args = parseArgs();

  const client = buildClient();

  // Режим проверки существующего задания без создания нового.
  if (args.check) {
    const job = await client.fineTuning.jobs.retrieve(args.check);
    console.log(`[finetune] Статус задания ${args.check}: ${job.status}`);
    if (job.status === 'succeeded') {
      console.log(`model_id: ${job.fine_tuned_model}`);
    } else if (job.error) {
      console.log(`Ошибка: ${JSON.stringify(job.error)}`);
    }
    return;
  }

  if (!args.file) {
    console.error('Ошибка: укажи --file=путь/к/датасету.jsonl');
    process.exit(1);
  }

  const datasetPath = path.resolve(process.cwd(), args.file);
  if (!fs.existsSync(datasetPath)) {
    console.error(`Файл не найден: ${datasetPath}`);
    process.exit(1);
  }

  validateJsonl(datasetPath);

  const baseModel = args['base-model'] || 'gpt-4o-mini-2024-07-18';
  const suffix = args.suffix || null;
  const pollSeconds = Number(args['poll-seconds'] ?? 30);

  const fileId = await uploadFile(client, datasetPath);
  const jobId = await createJob(client, fileId, baseModel, suffix);

  if (args['no-wait']) {
    console.log('\n[finetune] Задание запущено в фоне. Проверить статус позже:');
    console.log(`    node scripts/finetune-openai.js --check=${jobId}`);
    console.log(`job_id = ${jobId}`);
    return;
  }

  const job = await pollJob(client, jobId, pollSeconds);

  console.log('\n' + '='.repeat(60));
  if (job.status === 'succeeded') {
    console.log('ГОТОВО! Fine-tuned модель обучена успешно.');
    console.log(`model_id: ${job.fine_tuned_model}`);
    console.log('\nЧтобы использовать её в боте, впиши в backend/.env:');
    console.log(`    OPENAI_MODEL=${job.fine_tuned_model}`);
    console.log('и перезапусти бота: pm2 restart all');
    if (job.trained_tokens) {
      const approxCost = (job.trained_tokens / 1_000_000) * 3.0;
      console.log(`\nОбучено токенов: ${job.trained_tokens}`);
      console.log(
        `Ориентировочная стоимость обучения (по цене ~$3.00 / 1M токенов для gpt-4o-mini): $${approxCost.toFixed(2)} ` +
          '(уточни актуальную цену на platform.openai.com/pricing)',
      );
    }
  } else {
    console.log(`Задание завершилось со статусом: ${job.status}`);
    if (job.error) console.log(`Ошибка: ${JSON.stringify(job.error)}`);
  }
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('[finetune] Ошибка:', err);
  process.exit(1);
});
