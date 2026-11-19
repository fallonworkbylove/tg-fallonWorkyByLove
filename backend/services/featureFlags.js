/**
 * Бета-флаги: новые фичи только для тестовых / админ-операторов.
 * Источники: суперадмин, .env BETA_TESTER_*, таблица operator_roles (/menu → Доступ).
 */

const access = require('./operatorAccess');

/**
 * @param {{ telegram_user_id?: any, username?: string } | null} user
 */
function isBetaTester(user) {
  // sync: env + cache; кэш прогревается при старте и после изменений в /menu
  return access.isBetaTesterSync(user);
}

async function isBetaTesterAsync(user) {
  return access.isBetaTester(user);
}

function requireBetaTester(req, res, next) {
  // на каждый запрос подтягиваем свежий кэш (с TTL)
  access
    .isBetaTester(req.dbUser)
    .then((ok) => {
      if (ok) return next();
      return res.status(403).json({
        success: false,
        error: 'Фича в закрытом тесте',
      });
    })
    .catch((err) => {
      console.error('[featureFlags] beta check:', err.message);
      // fallback на sync (env)
      if (isBetaTester(req.dbUser)) return next();
      return res.status(403).json({
        success: false,
        error: 'Фича в закрытом тесте',
      });
    });
}

// Прогрев кэша при старте процесса
access.ensureSchema().then(() => access.listOperators()).catch((err) => {
  console.error('[featureFlags] operator_roles warmup:', err.message);
});

module.exports = {
  isBetaTester,
  isBetaTesterAsync,
  requireBetaTester,
  betaTesterIds: access.envTesterIds,
  betaTesterUsernames: access.envTesterUsernames,
};
