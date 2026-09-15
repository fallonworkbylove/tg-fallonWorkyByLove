const crypto = require('crypto');
const db = require('../db');
const OpenAI = require('openai');
const { buildOpenAIOptions } = require('./aiResponder');

// ---------------------------------------------------------------------------
// ОБУЧЕНИЕ БЕЗ FINE-TUNING.
//
// Идея (упрощённая версия python-примера с реальным fine-tuning модели):
// вместо того чтобы дообучать саму модель (дорого, и OpenAI больше не даёт
// fine-tuning новым аккаунтам), мы копим статистику "какие фразы бота
// хорошо/плохо сработали" и подмешиваем ЛУЧШИЕ (и худшие — чтобы не
// повторять ошибки) примеры прямо в системный промпт перед каждым ответом.
// Модель остаётся стандартной (gpt-4o-mini/gpt-4o) — никакой доплаты за
// инференс, только 1 короткий доп. запрос на оценку реакции собеседника.
//
// Цикл работы:
//   1. Бот отвечает -> recordBotReply() создаёт НОВУЮ запись "ожидающую
//      оценки" (можно накопить несколько таких записей на один диалог —
//      см. ниже, почему).
//   2. Собеседник пишет сообщения после ответа бота -> scoreAndLearn()
//      подкладывает каждое новое сообщение как очередной фрагмент РЕАКЦИИ.
//      Оценка выполняется не по одному сообщению, а по ОКНУ из
//      REACTION_LOOKAHEAD сообщений подряд — так короткое "хм" перед тем,
//      как человек согласился, не портит рейтинг удачной фразы.
//   3. При каждой генерации нового ответа buildLearningSnippet() достаёт
//      несколько лучших И несколько худших фраз (по всем аккаунтам сразу —
//      обучение общее), с приоритетом на: (а) тот же этап диалога, что и
//      сейчас, (б) более свежую статистику.
//
// Обучение общее для всех профилей: bot_patterns не хранит account_id,
// поэтому удачная фраза с одного аккаунта подсказывает всем остальным.
// ---------------------------------------------------------------------------

const LEARNING_ENABLED = process.env.LEARNING_ENABLED !== '0' && process.env.LEARNING_ENABLED !== 'false';

// Отдельный лёгкий клиент для оценки реакции. Обязательно строим его через
// buildOpenAIOptions() — так же, как основной клиент чата в aiResponder.js —
// иначе запросы идут напрямую с сервера и получают 403 Country/region not
// supported (api.openai.com блокирует российские IP).
const scorerClient = new OpenAI(buildOpenAIOptions());

// Сколько сообщений собеседника подряд после ответа бота учитывается как
// "реакция", прежде чем она получает финальную оценку. 2 — по данным
// переписок, реакция часто раскрывается не в первом же сообщении (сначала
// настороженное "хм", а через сообщение — реальное согласие).
const REACTION_LOOKAHEAD = 2;
// Если собеседник написал только 1 сообщение и затем надолго замолчал —
// не держим строку вечно: форсируем оценку по накопленному, если строка
// старше этого возраста.
const PENDING_MAX_AGE_HOURS = 6;

// Коэффициент экспоненциального затухания веса паттерна по возрасту:
// weight = success_rate * RECENCY_DECAY ^ (дней с последнего обновления).
// 0.985 => через 30 дней вес ~65% от исходного, через 90 дней ~24%.
// Не отбрасывает старые фразы совсем, но естественно смещает приоритет к
// более свежим (стиль переписки и трендовые фразы меняются со временем).
const RECENCY_DECAY = 0.985;

// Этапы диалога — используются, чтобы подсказки были в тему момента, а не
// случайным успешным примером из совершенно другой ситуации.
const STAGES = ['early_chat', 'objection_handling', 'nft_pitch', 'general'];

/**
 * Определяет текущий этап диалога по контексту, который уже собран в
 * telegramClient.js перед генерацией ответа. Приоритет: возражение важнее
 * NFT-подводки (если человек одновременно возражает и в разгаре кампании),
 * а ранний этап знакомства актуален только пока не всплыло ничего другое.
 */
function detectStage({ objectionHint, nftHint, historyLength } = {}) {
  if (objectionHint) return 'objection_handling';
  if (nftHint) return 'nft_pitch';
  if (typeof historyLength === 'number' && historyLength <= 6) return 'early_chat';
  return 'general';
}

async function columnExists(table, column) {
  const [rows] = await db.execute(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column],
  );
  return rows.length > 0;
}

async function addColumnIfMissing(table, column, definition) {
  if (await columnExists(table, column)) return;
  await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function ensureTables() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bot_patterns (
      id INT AUTO_INCREMENT PRIMARY KEY,
      trigger_msg TEXT,
      bot_reply TEXT,
      bot_reply_hash CHAR(32) NOT NULL,
      uses INT NOT NULL DEFAULT 0,
      success_score FLOAT NOT NULL DEFAULT 0,
      success_rate FLOAT NOT NULL DEFAULT 0,
      stage VARCHAR(32) NOT NULL DEFAULT 'general',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_reply_hash (bot_reply_hash)
    )
  `);
  // На случай, если таблица создавалась раньше без колонки stage.
  await addColumnIfMissing('bot_patterns', 'stage', "VARCHAR(32) NOT NULL DEFAULT 'general'");

  // Новая версия таблицы: несколько "ожидающих оценки" записей на диалог
  // одновременно (id — обычный автоинкремент, без уникальности по
  // account+peer), потому что пока одна запись донакапливает реакцию
  // (REACTION_LOOKAHEAD сообщений), бот успевает ответить и создать
  // следующую. reaction_msgs хранит уже накопленные сообщения-реакции как
  // JSON-массив.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS pending_reactions_v2 (
      id INT AUTO_INCREMENT PRIMARY KEY,
      account_id INT NOT NULL,
      peer_id VARCHAR(64) NOT NULL,
      user_msg TEXT,
      bot_reply TEXT,
      stage VARCHAR(32) NOT NULL DEFAULT 'general',
      reaction_msgs TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_account_peer (account_id, peer_id)
    )
  `);
}

const tablesReady = ensureTables().catch((err) => {
  console.error('[learningDb] Не удалось создать/обновить таблицы обучения:', err.message);
});

function hashReply(text) {
  return crypto.createHash('md5').update(String(text || '').trim().toLowerCase()).digest('hex');
}

/**
 * Запоминает пару (сообщение собеседника -> ответ бота) как новую запись,
 * ожидающую накопления реакции. Вызывается сразу после того, как бот
 * отправил ответ. В отличие от старой версии, НЕ перезатирает предыдущие
 * ещё не оценённые записи — они донакапливают реакцию независимо.
 */
async function recordBotReply(accountId, peerId, userMsg, botReply, stage = 'general') {
  if (!LEARNING_ENABLED || !botReply) return;
  try {
    await tablesReady;
    await db.execute(
      `INSERT INTO pending_reactions_v2 (account_id, peer_id, user_msg, bot_reply, stage, reaction_msgs)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [accountId, peerId, userMsg || '', botReply, stage, JSON.stringify([])],
    );
  } catch (err) {
    console.error('[learningDb] Не удалось сохранить ожидающую пару:', err.message);
  }
}

/**
 * Просит gpt-4o-mini оценить реакцию собеседника на предыдущий ответ бота
 * по короткой ПОСЛЕДОВАТЕЛЬНОСТИ его сообщений (а не одному) — так виден
 * итоговый настрой, а не промежуточная растерянность/пауза перед согласием.
 * Возвращает число: 1 (good), 0.5 (neutral), 0 (bad).
 */
async function scoreReaction(botReply, reactionMsgs) {
  try {
    const reactionText = reactionMsgs.filter(Boolean).join('\n');
    const completion = await scorerClient.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 5,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Ты оцениваешь переписку в мессенджере. Тебе дана фраза бота и следующие ' +
            'сообщения собеседника ПОСЛЕ неё (может быть 1-2 сообщения подряд). Оцени ' +
            'итоговую реакцию собеседника, а не промежуточную: ' +
            'GOOD — в итоге заинтересованно, тепло, продолжил разговор, согласился, задал вопрос в ответ; ' +
            'NEUTRAL — нейтрально, коротко, без явного интереса или отказа; ' +
            'BAD — холодно, раздражённо, разочарованно, проигнорировал суть, оборвал разговор. ' +
            'Ответь строго одним словом: GOOD, NEUTRAL или BAD.',
        },
        {
          role: 'user',
          content: `Фраза бота: "${botReply}"\nСообщения собеседника после неё:\n${reactionText}`,
        },
      ],
    });
    const verdict = (completion.choices[0]?.message?.content || '').trim().toUpperCase();
    if (verdict.includes('GOOD')) return 1;
    if (verdict.includes('BAD')) return 0;
    return 0.5;
  } catch (err) {
    console.error('[learningDb] Не удалось оценить реакцию:', err.message);
    return null;
  }
}

async function finalizePendingRow(row) {
  const reactionMsgs = safeParseArray(row.reaction_msgs);
  const score = await scoreReaction(row.bot_reply, reactionMsgs);
  await db.execute(`DELETE FROM pending_reactions_v2 WHERE id = ?`, [row.id]);
  if (score === null) return;

  const hash = hashReply(row.bot_reply);
  await db.execute(
    `INSERT INTO bot_patterns (trigger_msg, bot_reply, bot_reply_hash, uses, success_score, success_rate, stage)
     VALUES (?, ?, ?, 1, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       uses = uses + 1,
       success_score = success_score + ?,
       success_rate = (success_score + ?) / (uses + 1)`,
    [row.user_msg || '', row.bot_reply, hash, score, score, row.stage || 'general', score, score],
  );
}

function safeParseArray(json) {
  try {
    const parsed = JSON.parse(json || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

/**
 * Донакапливает новое сообщение собеседника во ВСЕ ожидающие оценки записи
 * этого диалога и финализирует (оценивает + удаляет) те, что набрали
 * REACTION_LOOKAHEAD сообщений или зависли дольше PENDING_MAX_AGE_HOURS.
 * Вызывается перед генерацией нового ответа, когда пришло новое сообщение.
 */
async function scoreAndLearn(accountId, peerId, newUserMsg) {
  if (!LEARNING_ENABLED) return;
  try {
    await tablesReady;
    const [rows] = await db.execute(
      `SELECT * FROM pending_reactions_v2 WHERE account_id = ? AND peer_id = ?`,
      [accountId, peerId],
    );
    if (!rows.length) return;

    for (const row of rows) {
      const reactionMsgs = safeParseArray(row.reaction_msgs);
      reactionMsgs.push(newUserMsg);

      const ageHours = (Date.now() - new Date(row.created_at).getTime()) / (60 * 60 * 1000);
      const shouldFinalize = reactionMsgs.length >= REACTION_LOOKAHEAD || ageHours >= PENDING_MAX_AGE_HOURS;

      if (shouldFinalize) {
        await finalizePendingRow({ ...row, reaction_msgs: JSON.stringify(reactionMsgs) });
      } else {
        await db.execute(`UPDATE pending_reactions_v2 SET reaction_msgs = ? WHERE id = ?`, [
          JSON.stringify(reactionMsgs),
          row.id,
        ]);
      }
    }
  } catch (err) {
    console.error('[learningDb] Не удалось обучиться на реакции:', err.message);
  }
}

/**
 * Достаёт паттерны с приоритетом: тот же этап диалога > более свежая
 * статистика > более высокая (или низкая, для худших) частота успеха.
 * direction: 'best' — success_rate DESC, 'worst' — success_rate ASC.
 */
async function getPatternsByStage(stage, { direction, limit, minUses, rateThreshold }) {
  try {
    await tablesReady;
    const rateCondition = direction === 'best' ? 'success_rate >= ?' : 'success_rate <= ?';
    const rateOrder = direction === 'best' ? 'DESC' : 'ASC';

    // Сначала пробуем строго по текущему этапу; если примеров мало —
    // дополняем общими (stage не совпадает), чтобы подсказка не была пустой.
    const [staged] = await db.execute(
      `SELECT trigger_msg, bot_reply, success_rate, stage,
              (CASE WHEN ? = 'best' THEN success_rate ELSE (1 - success_rate) END)
                * POW(${RECENCY_DECAY}, DATEDIFF(NOW(), updated_at)) AS weight
       FROM bot_patterns
       WHERE uses >= ? AND ${rateCondition} AND stage = ?
       ORDER BY weight DESC, uses DESC
       LIMIT ${Number(limit) || 4}`,
      [direction, minUses, rateThreshold, stage],
    );
    if (staged.length >= limit) return staged;

    const [general] = await db.execute(
      `SELECT trigger_msg, bot_reply, success_rate, stage,
              (CASE WHEN ? = 'best' THEN success_rate ELSE (1 - success_rate) END)
                * POW(${RECENCY_DECAY}, DATEDIFF(NOW(), updated_at)) AS weight
       FROM bot_patterns
       WHERE uses >= ? AND ${rateCondition} AND stage != ?
       ORDER BY weight DESC, uses DESC
       LIMIT ${Number(limit) || 4}`,
      [direction, minUses, rateThreshold, stage],
    );

    const combined = [...staged, ...general].slice(0, Number(limit) || 4);
    return combined;
  } catch (err) {
    console.error(`[learningDb] Не удалось получить паттерны (${direction}):`, err.message);
    return [];
  }
}

// Лимиты подняты с 4/3 до 6/4: чем больше живых примеров в промпте, тем
// сильнее модель ориентируется на реально сработавший стиль, а не только на
// абстрактное текстовое описание характера. minRate для хороших примеров
// слегка снижен (0.6 -> 0.55), потому что при небольшом объёме накопленной
// статистики (мало диалогов) строгий порог 0.6 отсекал почти всё и подсказка
// часто была пустой.
async function getBestPatterns(limit = 6, minUses = 2, minRate = 0.55, stage = 'general') {
  return getPatternsByStage(stage, { direction: 'best', limit, minUses, rateThreshold: minRate });
}

async function getWorstPatterns(limit = 4, minUses = 2, maxRate = 0.35, stage = 'general') {
  return getPatternsByStage(stage, { direction: 'worst', limit, minUses, rateThreshold: maxRate });
}

/**
 * Формирует текстовый блок с примерами удачных И неудачных фраз для
 * вставки в системный промпт, с приоритетом на текущий этап диалога.
 * Возвращает пустую строку, если обучение выключено или подходящих
 * примеров пока нет (мало данных).
 */
async function buildLearningSnippet(stage = 'general') {
  if (!LEARNING_ENABLED) return '';
  const [good, bad] = await Promise.all([getBestPatterns(6, 2, 0.55, stage), getWorstPatterns(4, 2, 0.35, stage)]);
  if (!good.length && !bad.length) return '';

  let snippet = '\n\n=== ОБУЧЕНИЕ НА ПРОШЛОМ ОПЫТЕ (это не гипотеза, это реально сработавшие диалоги) ===\n';

  if (good.length) {
    // Формат "Собеседник: ... / Вика: ..." оформлен как настоящий диалог, а
    // не как абстрактное описание "хорошо сработал ответ" — модели заметно
    // сильнее следуют примеру, поданному в форме реального обмена
    // репликами, чем текстовому пересказу о том, что сработало.
    snippet += 'РЕАЛЬНЫЕ примеры из других диалогов, где твой ответ дал хорошую реакцию собеседника ' +
      '(отсортированы от самых надёжных — используй именно эту манеру речи и реакции как эталон):\n';
    for (const p of good) {
      const trigger = (p.trigger_msg || '').slice(0, 150);
      const reply = (p.bot_reply || '').slice(0, 200);
      snippet += `Собеседник: «${trigger}»\nТы (сработало, успех ${Math.round(p.success_rate * 100)}%): «${reply}»\n\n`;
    }
  }

  if (bad.length) {
    snippet += 'А вот эти похожие по смыслу ответы дали ХОЛОДНУЮ/плохую реакцию — не повторяй сам подход, интонацию или формулировку:\n';
    for (const p of bad) {
      const trigger = (p.trigger_msg || '').slice(0, 150);
      const reply = (p.bot_reply || '').slice(0, 200);
      snippet += `Собеседник: «${trigger}»\nНЕ говори так (провалилось, успех всего ${Math.round(p.success_rate * 100)}%): «${reply}»\n\n`;
    }
  }

  snippet += 'ВАЖНО: если текущая реплика собеседника похожа по смыслу на один из примеров выше — ' +
    'ориентируйся на реально сработавший стиль сильнее, чем на общие абстрактные инструкции про характер. ' +
    'Не копируй фразы дословно (собеседник другой, слова должны звучать естественно именно сейчас) — ' +
    'бери саму интонацию, длину и структуру реакции.\n';
  return snippet;
}

module.exports = {
  LEARNING_ENABLED,
  STAGES,
  detectStage,
  recordBotReply,
  scoreAndLearn,
  buildLearningSnippet,
  getBestPatterns,
  getWorstPatterns,
};
