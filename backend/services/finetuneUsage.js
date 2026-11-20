/**
 * Учёт расходов на OpenAI (обычная и fine-tuned модель).
 *
 * После каждого запроса к chat.completions.create() aiResponder.js вызывает
 * logUsage(...) с реальными токенами из ответа API (completion.usage).
 * Стоимость считается по табличным ценам в MODEL_PRICING — их нужно
 * периодически проверять на platform.openai.com/pricing и поправлять здесь,
 * OpenAI API не отдаёт цену в самом ответе.
 *
 * Все записи копятся в таблице openai_usage_log, отчёт по дням/моделям —
 * через scripts/finetune-cost-report.js.
 */

const db = require('../db');

// Цены в $ за 1 миллион токенов. Проверять и обновлять вручную по
// https://platform.openai.com/docs/pricing — OpenAI меняет цены без API.
const MODEL_PRICING = {
  // Базовая gpt-4o-mini
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o-mini-2024-07-18': { input: 0.15, output: 0.6 },
  // Базовая gpt-4o (на случай если OPENAI_MODEL=gpt-4o)
  'gpt-4o': { input: 2.5, output: 10.0 },
  // Fine-tuned gpt-4o-mini обычно в ~2 раза дороже за токен использования
  // (обучение оплачивается отдельно, разово, см. finetune_openai.py).
  'ft:gpt-4o-mini': { input: 0.3, output: 1.2 },
};

/**
 * Подбирает цену по имени модели. Fine-tuned модели выглядят как
 * "ft:gpt-4o-mini-2024-07-18:org::abc123" — сверяем по префиксу.
 */
function getPricing(model) {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  if (model.startsWith('ft:gpt-4o-mini')) return MODEL_PRICING['ft:gpt-4o-mini'];
  if (model.startsWith('ft:gpt-4o')) return { input: 5.0, output: 20.0 };
  if (model.startsWith('gpt-4o-mini')) return MODEL_PRICING['gpt-4o-mini'];
  if (model.startsWith('gpt-4o')) return MODEL_PRICING['gpt-4o'];
  return null;
}

async function ensureTable() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS openai_usage_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      model VARCHAR(128) NOT NULL,
      prompt_tokens INT NOT NULL DEFAULT 0,
      completion_tokens INT NOT NULL DEFAULT 0,
      total_tokens INT NOT NULL DEFAULT 0,
      estimated_cost_usd DECIMAL(10, 6) NOT NULL DEFAULT 0,
      fell_back TINYINT(1) NOT NULL DEFAULT 0,
      account_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_model_date (model, created_at),
      INDEX idx_account_date (account_id, created_at)
    )
  `);
  // Старые инсталлы без account_id — догоняем колонку.
  try {
    const [cols] = await db.execute(
      `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'openai_usage_log'
         AND COLUMN_NAME = 'account_id'`,
    );
    if (!cols || !cols.length) {
      await db.execute(`ALTER TABLE openai_usage_log ADD COLUMN account_id INT NULL`);
      try {
        await db.execute(
          `ALTER TABLE openai_usage_log ADD INDEX idx_account_date (account_id, created_at)`,
        );
      } catch (_) {
        /* index may exist */
      }
    }
  } catch (err) {
    console.warn('[finetuneUsage] account_id migrate:', err.message);
  }
}

const tableReady = ensureTable().catch((err) => {
  console.error('[finetuneUsage] Не удалось создать таблицу openai_usage_log:', err.message);
});

/**
 * Логирует один запрос к OpenAI. Вызывать сразу после успешного
 * chat.completions.create() с полем usage из ответа.
 *
 * @param {string} model - реально использованная модель (учитывая fallback)
 * @param {{prompt_tokens?: number, completion_tokens?: number, total_tokens?: number}} usage
 * @param {{fellBack?: boolean, accountId?: number|string|null}} meta
 */
async function logUsage(model, usage, meta = {}) {
  try {
    await tableReady;
    const promptTokens = usage?.prompt_tokens || 0;
    const completionTokens = usage?.completion_tokens || 0;
    const totalTokens = usage?.total_tokens || promptTokens + completionTokens;

    const pricing = getPricing(model);
    const cost = pricing
      ? (promptTokens / 1_000_000) * pricing.input + (completionTokens / 1_000_000) * pricing.output
      : 0;

    if (!pricing) {
      console.warn(
        `[finetuneUsage] Неизвестная модель "${model}" — стоимость не посчитана. ` +
          'Добавь цену в MODEL_PRICING (services/finetuneUsage.js).',
      );
    }

    const accountId =
      meta.accountId != null && meta.accountId !== '' && Number.isFinite(Number(meta.accountId))
        ? Number(meta.accountId)
        : null;

    await db.execute(
      `INSERT INTO openai_usage_log
         (model, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, fell_back, account_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [model, promptTokens, completionTokens, totalTokens, cost, meta.fellBack ? 1 : 0, accountId],
    );
  } catch (err) {
    // Логирование расходов никогда не должно ронять ответ бота.
    console.error('[finetuneUsage] Не удалось записать usage:', err.message);
  }
}

/**
 * Сводка расходов за сегодня (МСК) и 7 дней — только для админ-радара.
 */
async function getCostSummary() {
  try {
    await tableReady;
    const [dayRows] = await db.execute(
      `SELECT
         COALESCE(SUM(total_tokens), 0) AS tokens,
         COALESCE(SUM(estimated_cost_usd), 0) AS cost_usd,
         COUNT(*) AS calls
       FROM openai_usage_log
       WHERE DATE(created_at + INTERVAL 3 HOUR) = DATE(UTC_TIMESTAMP() + INTERVAL 3 HOUR)`,
    );
    const [weekRows] = await db.execute(
      `SELECT
         COALESCE(SUM(total_tokens), 0) AS tokens,
         COALESCE(SUM(estimated_cost_usd), 0) AS cost_usd,
         COUNT(*) AS calls
       FROM openai_usage_log
       WHERE created_at >= (NOW() - INTERVAL 7 DAY)`,
    );
    const t = dayRows[0] || {};
    const w = weekRows[0] || {};
    return {
      today: {
        tokens: Number(t.tokens) || 0,
        cost_usd: Number(t.cost_usd) || 0,
        calls: Number(t.calls) || 0,
      },
      week7d: {
        tokens: Number(w.tokens) || 0,
        cost_usd: Number(w.cost_usd) || 0,
        calls: Number(w.calls) || 0,
      },
    };
  } catch (err) {
    console.error('[finetuneUsage] getCostSummary:', err.message);
    return {
      today: { tokens: 0, cost_usd: 0, calls: 0 },
      week7d: { tokens: 0, cost_usd: 0, calls: 0 },
    };
  }
}

/**
 * Агрегаты токенов/стоимости по account_id: сегодня (МСК) + всё время.
 * Старые строки без account_id не попадают в per-account (только в общий cost).
 * @returns {Map<number, {tokensToday:number,costToday:number,tokensAll:number,costAll:number,callsAll:number}>}
 */
async function getAccountCostMap() {
  const out = new Map();
  try {
    await tableReady;
    const [rows] = await db.execute(
      `SELECT
         account_id AS aid,
         COALESCE(SUM(total_tokens), 0) AS tokens_all,
         COALESCE(SUM(estimated_cost_usd), 0) AS cost_all,
         COUNT(*) AS calls_all,
         COALESCE(SUM(
           CASE
             WHEN DATE(created_at + INTERVAL 3 HOUR) = DATE(UTC_TIMESTAMP() + INTERVAL 3 HOUR)
             THEN total_tokens ELSE 0
           END
         ), 0) AS tokens_today,
         COALESCE(SUM(
           CASE
             WHEN DATE(created_at + INTERVAL 3 HOUR) = DATE(UTC_TIMESTAMP() + INTERVAL 3 HOUR)
             THEN estimated_cost_usd ELSE 0
           END
         ), 0) AS cost_today
       FROM openai_usage_log
       WHERE account_id IS NOT NULL
       GROUP BY account_id`,
    );
    for (const r of rows || []) {
      const id = Number(r.aid);
      if (!Number.isFinite(id)) continue;
      out.set(id, {
        tokensToday: Number(r.tokens_today) || 0,
        costToday: Number(r.cost_today) || 0,
        tokensAll: Number(r.tokens_all) || 0,
        costAll: Number(r.cost_all) || 0,
        callsAll: Number(r.calls_all) || 0,
      });
    }
  } catch (err) {
    console.error('[finetuneUsage] getAccountCostMap:', err.message);
  }
  return out;
}

module.exports = {
  logUsage,
  getPricing,
  MODEL_PRICING,
  getCostSummary,
  getAccountCostMap,
};
