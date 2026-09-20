/**
 * Импорт корпуса RAG day1/day2 из JSON или JSONL.
 *
 * Поддерживаемые JSON-форматы:
 *   1) Массив пар:
 *      [{"day":1,"client":"...","bot":"..."}, ...]
 *   2) Объект с day1 / day2:
 *      {"day1":[{"client":"...","bot":"..."}], "day2":[...]}
 *   3) Объект с examples / dialogs / data / items (массив внутри)
 *   4) Полный диалог как массив сообщений:
 *      {"day":1,"messages":[{"role":"user","content":"..."},{"role":"assistant","content":"..."}]}
 *   5) JSONL (по строке) — тоже ок
 *
 * Запуск (из папки backend):
 *   node scripts/import-rag-dialogues.js --file=./data/all.json --no-embed --clear
 *   node scripts/import-rag-dialogues.js --day1=./day1.json --day2=./day2.json --no-embed
 *   node scripts/import-rag-dialogues.js --backfill
 *   node scripts/import-rag-dialogues.js --stats
 */

try {
  require('dotenv').config();
} catch (_) {
  /* dotenv optional for --out convert on machines without node_modules */
}

const fs = require('fs');
const path = require('path');

function loadRag() {
  return require('../services/ragExamples');
}

function loadDb() {
  return require('../db');
}

function parseArgs() {
  const args = {
    files: [],
    dir: null,
    out: null,
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
    else if (key === 'dir') args.dir = val;
    else if (key === 'delay') args.delayMs = Number(val) || 40;
    else if (key === 'out') args.out = val;
  }
  return args;
}

function resolveDay(raw, forcedDay) {
  if (forcedDay === 1 || forcedDay === 2) return forcedDay;
  if (Number(raw) === 2) return 2;
  if (Number(raw) === 1) return 1;
  const s = String(raw || '').toLowerCase();
  if (s === 'day2' || s === 'day_2' || s === '2') return 2;
  if (s === 'day1' || s === 'day_1' || s === '1') return 1;
  return null;
}

function pickText(obj, keys) {
  for (const key of keys) {
    if (obj[key] != null && String(obj[key]).trim()) {
      return String(obj[key]).trim();
    }
  }
  return '';
}

function normalizePair(obj, forcedDay) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  const day = resolveDay(
    obj.day ?? obj.dialog_day ?? obj.day_num ?? obj.dayNumber,
    forcedDay,
  );

  const client = pickText(obj, [
    'client',
    'client_message',
    'user_message',
    'user',
    'human',
    'incoming',
    'message',
    'question',
    'input',
    'text',
    'peer',
    'man',
  ]);
  const bot = pickText(obj, [
    'bot',
    'bot_reply',
    'assistant_response',
    'assistant',
    'reply',
    'correct_answer',
    'answer',
    'response',
    'output',
    'girl',
    'woman',
  ]);

  if (!client || !bot || !day) return null;

  return {
    day,
    clientMessage: client,
    botReply: bot,
    source: obj.source ? String(obj.source) : null,
    stage: obj.stage ? String(obj.stage) : null,
  };
}

/**
 * Из массива сообщений {role, content} достаём пары user→assistant подряд.
 */
function pairsFromMessages(messages, forcedDay, defaultDay = 1) {
  const day = forcedDay || defaultDay;
  const rows = [];
  if (!Array.isArray(messages)) return rows;

  for (let i = 0; i < messages.length - 1; i++) {
    const a = messages[i];
    const b = messages[i + 1];
    if (!a || !b) continue;
    const roleA = String(a.role || a.from || a.speaker || '').toLowerCase();
    const roleB = String(b.role || b.from || b.speaker || '').toLowerCase();
    const textA = String(a.content ?? a.text ?? a.message ?? '').trim();
    const textB = String(b.content ?? b.text ?? b.message ?? '').trim();

    const aIsUser = /user|human|client|peer|man|мужчин|парень/.test(roleA);
    const bIsBot = /assistant|bot|girl|woman|ai|девушк/.test(roleB);
    if (aIsUser && bIsBot && textA && textB) {
      rows.push({
        day,
        clientMessage: textA,
        botReply: textB,
        source: null,
      });
    }
  }
  return rows;
}

function collectFromArray(arr, forcedDay, out) {
  for (const item of arr) {
    if (!item) continue;
    if (Array.isArray(item)) {
      // вложенный диалог-массив сообщений
      out.push(...pairsFromMessages(item, forcedDay));
      continue;
    }
    if (typeof item !== 'object') continue;

    const pair = normalizePair(item, forcedDay);
    if (pair) {
      out.push(pair);
      continue;
    }

    if (Array.isArray(item.messages)) {
      const day = resolveDay(item.day, forcedDay) || forcedDay || 1;
      out.push(...pairsFromMessages(item.messages, day));
      continue;
    }
    if (Array.isArray(item.dialogue) || Array.isArray(item.dialog) || Array.isArray(item.turns)) {
      const msgs = item.dialogue || item.dialog || item.turns;
      const day = resolveDay(item.day, forcedDay) || forcedDay || 1;
      out.push(...pairsFromMessages(msgs, day));
    }
  }
}

function collectFromObject(obj, forcedDay, out) {
  // {"day1":[...], "day2":[...]}
  for (const [key, val] of Object.entries(obj)) {
    const keyDay = resolveDay(key, null);
    if (keyDay && Array.isArray(val)) {
      collectFromArray(val, forcedDay || keyDay, out);
    }
  }

  // {"examples":[...]} / {"dialogs":[...]} / {"data":[...]}
  for (const key of ['examples', 'dialogs', 'dialogues', 'data', 'items', 'pairs', 'rows', 'corpus']) {
    if (Array.isArray(obj[key])) {
      collectFromArray(obj[key], forcedDay, out);
    }
  }

  // один диалог в корне
  if (Array.isArray(obj.messages)) {
    const day = resolveDay(obj.day, forcedDay) || forcedDay || 1;
    out.push(...pairsFromMessages(obj.messages, day));
  }

  // одиночная пара в корне
  const single = normalizePair(obj, forcedDay);
  if (single) out.push(single);
}

/**
 * Достаёт отдельные {...} объекты из «битого» JSON:
 * поток объектов через запятую без обёртки [...], обрезанный хвост и т.п.
 */
function extractJsonObjects(text) {
  const objects = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    while (i < n && text[i] !== '{') i += 1;
    if (i >= n) break;
    const start = i;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (; i < n; i++) {
      const ch = text[i];
      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === '\\') {
          escape = true;
          continue;
        }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const slice = text.slice(start, i + 1);
          try {
            objects.push(JSON.parse(slice));
          } catch (_) {
            /* skip broken object */
          }
          i += 1;
          break;
        }
      }
    }
    if (depth !== 0) break; // хвост обрезан — стоп
  }
  return objects;
}

function readCorpusFile(filePath, forcedDay) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Файл не найден: ${abs}`);
  }
  const raw = fs.readFileSync(abs, 'utf8').replace(/^\uFEFF/, '');
  const out = [];

  // 1) Цельный JSON (.json)
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      collectFromArray(parsed, forcedDay, out);
    } else if (parsed && typeof parsed === 'object') {
      collectFromObject(parsed, forcedDay, out);
    }
    if (out.length) {
      console.log(`[import] ${path.basename(abs)}: JSON, пар: ${out.length}`);
      return out;
    }
  } catch (_) {
    // дальше — поток объектов / JSONL
  }

  // 2) Поток {...}, {...} без массива (AyuGram exports)
  const streamed = extractJsonObjects(raw);
  if (streamed.length) {
    collectFromArray(streamed, forcedDay, out);
    if (out.length) {
      console.log(
        `[import] ${path.basename(abs)}: поток объектов (${streamed.length} шт.), пар: ${out.length}`,
      );
      return out;
    }
  }

  // 3) JSONL
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (err) {
      console.warn(`[import] ${path.basename(abs)} строка ${i + 1}: невалидный JSON (${err.message})`);
      continue;
    }
    if (Array.isArray(obj)) collectFromArray(obj, forcedDay, out);
    else if (obj && typeof obj === 'object') collectFromObject(obj, forcedDay, out);
  }

  console.log(`[import] ${path.basename(abs)}: JSONL/смешанный, пар: ${out.length}`);
  return out;
}

async function printStats(ragExamples) {
  const rows = await ragExamples.countByDay();
  if (!rows.length) {
    console.log('Корпус пуст.');
    return;
  }
  for (const row of rows) {
    console.log(`day ${row.day}: ${row.n} примеров, с embedding: ${row.with_embed}`);
  }
}

async function main() {
  const args = parseArgs();

  if (args.dir) {
    const dirAbs = path.resolve(args.dir);
    const names = fs
      .readdirSync(dirAbs)
      .filter((f) => /\.jsonl?$/i.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const name of names) {
      args.files.push({ path: path.join(dirAbs, name), day: null });
    }
    console.log(`[import] папка ${dirAbs}: ${names.length} файлов`);
  }

  // Только конвертация в чистый JSON без БД
  if (args.out && args.files.length) {
    const all = [];
    const seen = new Set();
    for (const file of args.files) {
      const rows = readCorpusFile(file.path, file.day);
      for (const row of rows) {
        if (!row.day) continue;
        const key = `${row.day}|${row.clientMessage}|${row.botReply}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push({
          day: row.day,
          client: row.clientMessage,
          bot: row.botReply,
          stage: row.stage || undefined,
          source: path.basename(file.path),
        });
      }
    }
    const outAbs = path.resolve(args.out);
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(outAbs, JSON.stringify(all, null, 2), 'utf8');
    const d1 = all.filter((r) => r.day === 1).length;
    const d2 = all.filter((r) => r.day === 2).length;
    console.log(`Записано ${all.length} пар → ${outAbs} (day1=${d1}, day2=${d2})`);
    return;
  }

  const ragExamples = loadRag();
  const db = loadDb();
  await ragExamples.ensureSchema();

  if (args.stats && !args.files.length && !args.backfill) {
    await printStats(ragExamples);
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
  let skippedNoDay = 0;

  for (const file of args.files) {
    const rows = readCorpusFile(file.path, file.day);
    const usable = [];
    for (const row of rows) {
      if (!row.day) {
        skippedNoDay += 1;
        continue;
      }
      usable.push(row);
    }
    console.log(
      `[import] ${file.path}: к загрузке ${usable.length}` +
        (skippedNoDay ? ` (без day пропущено накоплено: ${skippedNoDay})` : '') +
        ` (day force=${file.day ?? 'from file'})`,
    );

    for (const row of usable) {
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

  await printStats(ragExamples);
  await db.end();
}

main().catch(async (err) => {
  console.error(err);
  try {
    const db = loadDb();
    await db.end();
  } catch (_) {}
  process.exit(1);
});
