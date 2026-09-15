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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_model_date (model, created_at)
    )
  `);
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
 * @param {{fellBack?: boolean}} meta - fellBack=true если сработал фолбэк на другую модель
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

    await db.execute(
      `INSERT INTO openai_usage_log (model, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, fell_back)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [model, promptTokens, completionTokens, totalTokens, cost, meta.fellBack ? 1 : 0],
    );
  } catch (err) {
    // Логирование расходов никогда не должно ронять ответ бота.
    console.error('[finetuneUsage] Не удалось записать usage:', err.message);
  }
}

module.exports = { logUsage, getPricing, MODEL_PRICING };
