/**
 * Импорт корпуса RAG day1/day2 из JSONL.
 *
 * Формат строки (одна JSON-пара на строку):
 *   {"day":1,"client":"привет","bot":"приветик)"}
 *   {"day":2,"client_message":"...","bot_reply":"..."}
 *
 * Примеры запуска (из папки backend):
 *   node scripts/import-rag-dialogues.js --file=./data/rag.jsonl
 *   node scripts/import-rag-dialogues.js --day1=./data/day1.jsonl --day2=./data/day2.jsonl
 *   node scripts/import-rag-dialogues.js --file=./data/rag.jsonl --no-embed
 *   node scripts/import-rag-dialogues.js --backfill
 *   node scripts/import-rag-dialogues.js --stats
 *
 * --no-embed: быстрый импорт без OpenAI, потом --backfill для векторов.
 * --clear: удалить старый корпус перед импортом.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const ragExamples = require('../services/ragExamples');
const db = require('../db');

function parseArgs() {
  const args = {
    files: [],
    noEmbed: false,
    backfill: false,
    stats: false,
    clear: false,
    delayMs: 40,
  };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--no-embed') {
      args.noEmbed = true;
      continue;
    }
    if (arg === '--backfill') {
      args.backfill = true;
      continue;
    }
    if (arg === '--stats') {
      args.stats = true;
      continue;
    }
    if (arg === '--clear') {
      args.clear = true;
      continue;
    }
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2];
    if (key === 'file') args.files.push({ path: val, day: null });
    else if (key === 'day1') args.files.push({ path: val, day: 1 });
    else if (key === 'day2') args.files.push({ path: val, day: 2 });
    else if (key === 'delay') args.delayMs = Number(val) || 40;
  }
  return args;
}

function normalizeRow(obj, forcedDay) {
  if (!obj || typeof obj !== 'object') return null;
  const dayRaw = forcedDay != null ? forcedDay : obj.day ?? obj.dialog_day ?? obj.day_num;
  const day = Number(dayRaw) === 2 ? 2 : Number(dayRaw) === 1 ? 1 : null;
  const client = String(
    obj.client ?? obj.client_message ?? obj.user ?? obj.human ?? obj.incoming ?? '',
  ).trim();
  const bot = String(
    obj.bot ?? obj.bot_reply ?? obj.assistant ?? obj.reply ?? obj.correct_answer ?? '',
  ).trim();
  if (!day || !client || !bot) return null;
  return {
    day,
    clientMessage: client,
    botReply: bot,
    source: obj.source ? String(obj.source) : null,
  };
}

function readJsonl(filePath, forcedDay) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Файл не найден: ${abs}`);
  }
  const raw = fs.readFileSync(abs, 'utf8');
  const rows = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (err) {
      console.warn(`[import] строка ${i + 1}: невалидный JSON (${err.message})`);
      continue;
    }
    // Массив в одной строке / весь файл как JSON-массив
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const row = normalizeRow(item, forcedDay);
        if (row) rows.push(row);
      }
      continue;
    }
    const row = normalizeRow(obj, forcedDay);
    if (row) rows.push(row);
    else console.warn(`[import] строка ${i + 1}: пропуск (нужны day + client + bot)`);
  }

  // Если файл целиком — JSON-массив без JSONL
  if (!rows.length) {
    try {
      const whole = JSON.parse(raw);
      if (Array.isArray(whole)) {
        for (const item of whole) {
          const row = normalizeRow(item, forcedDay);
          if (row) rows.push(row);
        }
      }
    } catch (_) {
      /* already tried line-by-line */
    }
  }
  return rows;
}

async function printStats() {
  const rows = await ragExamples.countByDay();
  if (!rows.length) {
    console.log('Корпус пуст.');
    return;
  }
  for (const row of rows) {
    console.log(
      `day ${row.day}: ${row.n} примеров, с embedding: ${row.with_embed}`,
    );
  }
}

async function main() {
  const args = parseArgs();
  await ragExamples.ensureSchema();

  if (args.stats && !args.files.length && !args.backfill) {
    await printStats();
    await db.end();
    return;
  }

  if (args.clear) {
    await db.execute('DELETE FROM rag_dialogue_examples');
    ragExamples.invalidateCache();
    console.log('Корпус очищен.');
  }

  let imported = 0;
  let withEmbed = 0;
  let failed = 0;

  for (const file of args.files) {
    const rows = readJsonl(file.path, file.day);
    console.log(`[import] ${file.path}: ${rows.length} пар (day force=${file.day ?? 'from file'})`);
    for (const row of rows) {
      try {
        const res = await ragExamples.upsertExample({
          ...row,
          source: row.source || path.basename(file.path),
          skipEmbed: args.noEmbed,
        });
        imported += 1;
        if (res.has_embedding) withEmbed += 1;
        if (!args.noEmbed && args.delayMs > 0) {
          await new Promise((r) => setTimeout(r, args.delayMs));
        }
      } catch (err) {
        failed += 1;
        console.warn(`[import] ошибка: ${err.message}`);
      }
    }
  }

  if (args.files.length) {
    console.log(`Импорт готов: ${imported} ок, embeddings: ${withEmbed}, ошибок: ${failed}`);
  }

  if (args.backfill || (args.files.length && args.noEmbed)) {
    console.log('Backfill embeddings...');
    let totalDone = 0;
    for (;;) {
      const res = await ragExamples.backfillEmbeddings({
        limit: 100,
        delayMs: args.delayMs,
      });
      totalDone += res.done;
      console.log(`  +${res.done} (failed ${res.failed})`);
      if (res.done === 0) break;
    }
    console.log(`Backfill всего: ${totalDone}`);
  }

  await printStats();
  await db.end();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await db.end();
  } catch (_) {}
  process.exit(1);
});
