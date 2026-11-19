/**
 * Общая подготовка текста перед sendHumanText (live + reengage).
 */
'use strict';

function prepareOutboundText(outText, { voiceFileName = null, history = null, accountId = null } = {}) {
  let text = outText;
  if (!text) return '';
  try {
    const vr = require('./voiceReplies');
    text = vr.stripLeakedVoiceTag(text);
    text = vr.stripDayAskDupWithVoprosy(text, {
      voiceFileName,
      history,
    });
  } catch (_) {
    /* optional */
  }
  if (!text) return '';
  try {
    if (accountId != null) {
      text = require('./humanExtra').applyAccountSlang(text, accountId);
    }
  } catch (_) {
    /* optional */
  }
  return String(text || '').trim();
}

module.exports = { prepareOutboundText };
