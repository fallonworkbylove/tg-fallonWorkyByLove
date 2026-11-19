/**
 * Снять пары он/она из stdin JSON и прогнать через локальный Ollama Qwen
 * как классификатор BAD/OK. Идеи не просим — только метки.
 *
 *   node scripts/_qwen_flag_bad_replies.js < pairs.json
 *
 * pairs.json: [{ "u": "...", "a": "...", "peer": "..." }, ...]
 */
const fs = require('fs');

// Классификатор: Gemma держит метки лучше, чем coder/Saiga/14B на rewrite.
const MODEL = process.env.QWEN_MODEL || process.env.IDEA_MODEL || 'gemma2:9b';
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

async function main() {
  const raw = fs.readFileSync(0, 'utf8').replace(/^[^\[]+/, '').trim();
  const pairs = JSON.parse(raw).slice(0, 40);
  const body = pairs
    .map((p, i) => `${i + 1}. ОН: ${String(p.u).slice(0, 120)}\n   ОНА: ${String(p.a).slice(0, 120)}`)
    .join('\n');
  const prompt =
    'Классификатор ответов девушки в Telegram-дейтинге.\n' +
    'BAD: корпоратив, вики, пустое поняла/спасибо, анкета «просто общение», мета про связь, допрос на фото, обещание фото потом, жалоба «редко кто пишет».\n' +
    'OK: коротко и по-человечески.\n' +
    'Строки: N BAD|OK <до 8 слов>. Без вступления.\n\n' +
    body;

  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      options: { temperature: 0.1, num_predict: 800 },
      prompt,
    }),
  });
  const json = await res.json();
  const text = String(json.response || json.error || '');
  process.stdout.write(text);
  if (!text.endsWith('\n')) process.stdout.write('\n');

  // Локальный эвристический второй проход — Qwen часто врёт.
  console.error('\n--- heuristic BAD ---');
  const heur = [
    [/просто\s+общение|ничего\s+конкретного/i, 'seeking-template'],
    [/цифров\w*\s+актив|типа\s+криптовалют/i, 'crypto-wiki'],
    [/всегда\s+(?:норм|удобн|хорош)|полезн[а-яё]*\s+штук|новый\s+этап/i, 'corporate'],
    [/связь\s+восстанов/i, 'meta-connection'],
    [/напомни|не\s+очень\s+выгляжу/i, 'defer-photo'],
    [/редко\s+кто\s+пишет/i, 'lonely'],
    [/^(?:поняла|спасиб[оа]?|спс)\s*\)*$/i, 'bare-ack'],
  ];
  for (let i = 0; i < pairs.length; i += 1) {
    const a = String(pairs[i].a || '');
    const hit = heur.find(([re]) => re.test(a));
    if (hit) console.error(`${i + 1} BAD ${hit[1]} :: ${a.slice(0, 80)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
