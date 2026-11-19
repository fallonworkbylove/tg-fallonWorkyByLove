/**
 * Ранний авто-архив мусора (мат / «сколько платят» / явный скам-допрос)
 * без ожидания howlong 21д. Пишет отсев note «мусор».
 */

const TRASH_RE =
  /(?:сколько\s+(?:ты\s+)?(?:плат|платишь|зарабатыв)|сколько\s+платят|ты\s+с\s+мамонт|мамонт|наёб|развод\s+на\s+деньг|скам|мошен|иди\s+нах|пош[её]л\s+нах|заткнись|убей|сдохн|шлюх[аи]|проститут)/i;

const HEAVY_MAT_RE =
  /(?:^|[\s,])(?:бляд|ебан|хуйло|пизд[аеу]|нахуй|похуй|ебать)(?:[\s,!.)]|$)/i;

function isTrashPeerMessage(text) {
  const t = String(text || '')
    .replace(/^\[[^\]]*\]:\s*/gm, '')
    .trim();
  if (!t || t.length < 4) return false;
  if (TRASH_RE.test(t)) return true;
  // тяжёлый мат + короткая агрессия
  if (HEAVY_MAT_RE.test(t) && t.length < 80 && /(?:^|\s)(?:ты|вам|вас|тебе)\b/i.test(t)) {
    return true;
  }
  return false;
}

module.exports = { isTrashPeerMessage, TRASH_RE };
