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

// Эти фразы нельзя показывать как «удачные» — иначе learning снова учит
// соглашаться на встречи (см. «скоро увидимся» / «погуляем когда приеду»).
const MEET_LEAK_REPLY_RE =
  /(скоро\s+)?увидимся|встретимся|погуляем|жду\s+тебя\s+тоже|когда\s+я\s+приеду|приеду\s+и\s+погул|обязательно\s+увид|давай\s+встрети|где\s+планируешь\s+встрет/i;

// Отсев «поисковых»/ИИ-фраз из лучших примеров (по правилам живого промпта).
const AI_ESSAY_REPLY_RE =
  /действительно\s+может|всегда\s+помогает|важно\s+помнить|в\s+итоге|кроме\s+того|таким\s+образом|это\s+хорошо,?\s+потому|уверенность\s+всегда|музыка\s+действительно|пробуждать\s+воспоминан/i;

function isMeetLeakReply(text) {
  return MEET_LEAK_REPLY_RE.test(String(text || ''));
}

/** Подходит ли фраза под «живой» промпт: коротко, без встреч/эссе/списков. */
function isHumanStyleReply(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (isMeetLeakReply(t)) return false;
  if (t.length < 2 || t.length > 140) return false;
  if (/\n/.test(t)) return false;
  if (AI_ESSAY_REPLY_RE.test(t)) return false;
  if (/(^|\n)\s*[-•*]\s+/m.test(t)) return false;
  const clauses = t.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  if (clauses.length > 3) return false;
  return true;
}

function filterMeetLeaks(rows, direction) {
  if (!Array.isArray(rows)) return [];
  if (direction === 'best') {
    return rows.filter((r) => isHumanStyleReply(r.bot_reply));
  }
  return rows;
}

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
  // "Закреплённые" вручную примеры (см. pinPattern/scripts/pin-pattern.js) —
  // всегда попадают в подсказку few-shot независимо от uses/success_rate,
  // на случай, когда конкретная фраза явно хороша, но статистики по ней
  // пока накопилось мало.
  await addColumnIfMissing('bot_patterns', 'pinned', 'TINYINT(1) NOT NULL DEFAULT 0');
  // Различает закреплённый "хороший" эталон (pinned_bad=0) от закреплённого
  // "плохого" примера (pinned_bad=1) — плохой пример всегда показывается
  // модели как "никогда не делай так", независимо от накопленной статистики.
  await addColumnIfMissing('bot_patterns', 'pinned_bad', 'TINYINT(1) NOT NULL DEFAULT 0');

  // Новая версия таблицы: несколько "ожидающих оценки" записей на диалог
  // одновременно (id — обычный автоинкремент, без уникальности по
  // account+peer), пот��му что пока одна запись донакапливает реакцию
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
    const wantedLimit = Number(limit) || 4;

    // Закреплённые вручную примеры (pinned=1) всегда идут первыми и не
    // фильтруются по uses/success_rate — они закреплены именно потому, что
    // статистики может быть мало (или пример специально важен), а результат
    // уже очевиден. pinned_bad различает закреплённый "хороший" эталон
    // (используется в направлении best) от закреплённого "плохого" примера,
    // который всегда должен показываться как "никогда так не делай"
    // (используется в направлении worst).
    const pinnedBadFlag = direction === 'best' ? 0 : 1;
    const fetchLimit = Math.max(wantedLimit * 4, 16);
    const [pinnedRaw] = await db.execute(
      `SELECT trigger_msg, bot_reply, success_rate, stage, pinned, pinned_bad
       FROM bot_patterns
       WHERE pinned = 1 AND pinned_bad = ?
       ORDER BY updated_at DESC
       LIMIT ${fetchLimit}`,
      [pinnedBadFlag],
    );
    const pinned = filterMeetLeaks(pinnedRaw, direction).slice(0, wantedLimit);
    if (pinned.length >= wantedLimit) return pinned;
    const remainingLimit = wantedLimit - pinned.length;

    // Сначала пробуем строго по текущему этапу; если примеров мало —
    // дополняем общими (stage не совпадает), чтобы подсказка не была пустой.
    // Закреплённые записи исключаем из обычной выборки, чтобы не показать
    // их дважды. Берём с запасом — часть отфильтруем как «утечку встреч».
    const [stagedRaw] = await db.execute(
      `SELECT trigger_msg, bot_reply, success_rate, stage, pinned, pinned_bad,
              (CASE WHEN ? = 'best' THEN success_rate ELSE (1 - success_rate) END)
                * POW(${RECENCY_DECAY}, DATEDIFF(NOW(), updated_at)) AS weight
       FROM bot_patterns
       WHERE uses >= ? AND ${rateCondition} AND stage = ? AND pinned = 0
       ORDER BY weight DESC, uses DESC
       LIMIT ${fetchLimit}`,
      [direction, minUses, rateThreshold, stage],
    );
    const staged = filterMeetLeaks(stagedRaw, direction).slice(0, remainingLimit);
    if (pinned.length + staged.length >= wantedLimit) return [...pinned, ...staged];

    const [generalRaw] = await db.execute(
      `SELECT trigger_msg, bot_reply, success_rate, stage, pinned, pinned_bad,
              (CASE WHEN ? = 'best' THEN success_rate ELSE (1 - success_rate) END)
                * POW(${RECENCY_DECAY}, DATEDIFF(NOW(), updated_at)) AS weight
       FROM bot_patterns
       WHERE uses >= ? AND ${rateCondition} AND stage != ? AND pinned = 0
       ORDER BY weight DESC, uses DESC
       LIMIT ${fetchLimit}`,
      [direction, minUses, rateThreshold, stage],
    );
    const general = filterMeetLeaks(generalRaw, direction);

    const combined = [...pinned, ...staged, ...general].slice(0, wantedLimit);
    return combined;
  } catch (err) {
    console.error(`[learningDb] Не удалось получить паттерны (${direction}):`, err.message);
    return [];
  }
}

/**
 * Закрепляет паттерн (по подстроке в trigger_msg и/или bot_reply) так, чтобы
 * он всегда попадал в подсказку few-shot, независимо от накопленной
 * статистики. По умолчанию закрепляет как "хороший" эталон (success_rate
 * принудительно = 1). С `bad: true` закрепляет как "плохой" пример
 * (success_rate принудительно = 0) — он будет всегда показываться модели
 * как "никогда так не делай", даже если статистики по нему пока мало.
 * Используется скриптом scripts/pin-pattern.js.
 */
async function pinPattern({ triggerContains, replyContains, bad = false }) {
  await tablesReady;
  const conditions = [];
  const params = [];
  if (triggerContains) {
    conditions.push('trigger_msg LIKE ?');
    params.push(`%${triggerContains}%`);
  }
  if (replyContains) {
    conditions.push('bot_reply LIKE ?');
    params.push(`%${replyContains}%`);
  }
  if (!conditions.length) throw new Error('Нужно указать triggerContains и/или replyContains.');

  const [rows] = await db.execute(
    `SELECT id, trigger_msg, bot_reply FROM bot_patterns WHERE ${conditions.join(' AND ')}`,
    params,
  );
  if (!rows.length) return { updated: 0, rows: [] };

  const ids = rows.map((r) => r.id);
  const forcedRate = bad ? 0 : 1;
  await db.execute(
    `UPDATE bot_patterns
     SET pinned = 1, pinned_bad = ?, success_rate = ?, success_score = ? * uses, uses = GREATEST(uses, 2)
     WHERE id IN (${ids.map(() => '?').join(',')})`,
    [bad ? 1 : 0, forcedRate, forcedRate, ...ids],
  );
  return { updated: ids.length, rows, bad };
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
  const [good, bad] = await Promise.all([
    // minUses=1: в пул попадают и одноразовые удачные фразы; «человечность»
    // режет isHumanStyleReply (длина, без встреч/эссе).
    getBestPatterns(8, 1, 0.5, stage),
    getWorstPatterns(4, 2, 0.35, stage),
  ]);
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
      // Закреплённые примеры (pinned=1) помечаются отдельно — это не
      // статистический вывод из истории, а вручную подтверждённый эталон,
      // ему нужно следовать даже строже обычных "сработавших" фраз.
      const label = p.pinned
        ? 'ВСЕГДА используй именно такую манеру в похожей ситуации'
        : `сработало, успех ${Math.round(p.success_rate * 100)}%`;
      snippet += `Собеседник: «${trigger}»\nТы (${label}): «${reply}»\n\n`;
    }
  }

  if (bad.length) {
    snippet += 'А вот эти похожие по смыслу ответы дали ХОЛОДНУЮ/плохую реакцию — не повторяй сам подход, интонацию или формулировку:\n';
    for (const p of bad) {
      const trigger = (p.trigger_msg || '').slice(0, 150);
      const reply = (p.bot_reply || '').slice(0, 200);
      // Закреплённые плохие примеры (pinned=1, pinned_bad=1) — это не
      // статистический вывод, а вручную подтверждённый запрет: в похожей
      // ситуации так отвечать нельзя категорически, а не просто "не
      // рекомендуется".
      const label = p.pinned
        ? 'НИКОГДА не говори так в похожей ситуации — это точно провалит разговор'
        : `провалилось, успех всего ${Math.round(p.success_rate * 100)}%`;
      snippet += `Собеседник: «${trigger}»\nНЕ говори так (${label}): «${reply}»\n\n`;
    }
  }

  snippet += 'ВАЖНО: если текущая реплика собеседн��ка похожа по смыслу на один из примеров выше — ' +
    'ориентируйся на реально сработавший стиль сильнее, чем на общие абстрактные инструкции про характер. ' +
    'Не копируй фразы дословно (собеседник другой, слова должны звучать естественно именно сейчас) — ' +
    'бери саму интонацию, длину и структуру реакции.\n';
  return snippet;
}

function tokensOf(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 2);
}

function exampleScore(incoming, clientMessage) {
  const incomingNorm = tokensOf(incoming).join(' ');
  const exampleNorm = tokensOf(clientMessage).join(' ');
  if (!incomingNorm || !exampleNorm) return 0;
  if (incomingNorm.includes(exampleNorm) || exampleNorm.includes(incomingNorm)) return 1;
  const incomingSet = new Set(tokensOf(incoming));
  let hits = 0;
  for (const word of tokensOf(clientMessage)) {
    if (incomingSet.has(word)) hits += 1;
  }
  return hits / tokensOf(clientMessage).length;
}

/**
 * Примеры из вкладки «Учить» (training_examples). Это прямые указания
 * владельца, не статистика реакций. Похожие на текущую реплику идут первыми,
 * остальные недавние — чтобы заметка тоже влияла на тон.
 */
async function buildManualTrainingSnippet(accountId, incomingText) {
  try {
    const [rows] = await db.execute(
      `SELECT client_message, correct_answer, note
       FROM training_examples
       WHERE account_id = ?
       ORDER BY id DESC
       LIMIT 24`,
      [accountId],
    );
    if (!rows.length) return '';

    const matched = rows
      .map((row) => ({ row, score: exampleScore(incomingText, row.client_message) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
    const picked = [];
    const used = new Set();
    for (const item of matched) {
      if (picked.length >= 6) break;
      picked.push(item.row);
      used.add(item.row);
    }
    for (const row of rows) {
      if (picked.length >= 6) break;
      if (matched.length && picked.length >= 4) break;
      if (used.has(row)) continue;
      picked.push(row);
      used.add(row);
    }
    if (!picked.length) return '';

    let snippet = '\n\n=== ПРИМЕРЫ ИЗ ВКЛАДКИ «УЧИТЬ» ===\n';
    snippet += 'Это прямые указания владельца, не статистика. ';
    snippet += 'Если реплика собеседника похожа на «Человек», отвечай в том же смысле и тоне, что «Ответ». ';
    snippet += 'Не копируй дословно, если ситуация чуть другая, но суть бери отсюда. Заметку соблюдай.\n';
    for (const row of picked) {
      snippet += `Человек: «${String(row.client_message || '').slice(0, 180)}»\n`;
      snippet += `Ответ: «${String(row.correct_answer || '').slice(0, 220)}»\n`;
      if (row.note) snippet += `Заметка: ${String(row.note).slice(0, 160)}\n`;
      snippet += '\n';
    }
    return snippet;
  } catch (err) {
    console.error('[learningDb] Не удалось прочитать примеры из вкладки «Учить»:', err.message);
    return '';
  }
}

module.exports = {
  LEARNING_ENABLED,
  STAGES,
  detectStage,
  recordBotReply,
  scoreAndLearn,
  buildLearningSnippet,
  buildManualTrainingSnippet,
  getBestPatterns,
  getWorstPatterns,
  pinPattern,
};
