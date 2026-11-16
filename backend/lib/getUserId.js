/**
 * id пользователя из telegramAuth. Без fallback на 1 —
 * иначе при сбое auth запросы уходят под чужой аккаунт.
 */
function getUserId(req) {
  const id = req?.dbUser?.id;
  if (id == null || id === '') {
    const err = new Error('Нет авторизации');
    err.status = 401;
    err.statusCode = 401;
    throw err;
  }
  return id;
}

module.exports = getUserId;
