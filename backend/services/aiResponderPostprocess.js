/**
 * Финальный постпроцесс ответа (единственный ensureAck + voprosy-strip).
 */
'use strict';

function lowercaseSentenceStarts(text) {
  const s = String(text || '');
  if (!s) return s;
  return s.replace(/(^|[.!?…]\s+)([А-ЯЁA-Z])/g, (_, p, ch) => p + ch.toLowerCase());
}

function finalizeOutgoingReply(text, userMessage, opts = {}) {
  let finalOut = lowercaseSentenceStarts(text);
  try {
    const vr = require('./voiceReplies');
    finalOut = vr.stripLeakedVoiceTag(finalOut);
    finalOut = vr.softVoiceAskWithoutFile(finalOut, userMessage, {
      voiceWillSend: !!opts.voiceWillSend || !!opts.voiceFileName,
    });
    finalOut = vr.stripDayAskDupWithVoprosy(finalOut, {
      history: opts.history || null,
      voiceFileName: opts.voiceFileName || null,
    });
  } catch (_) {
    /* optional */
  }
  try {
    const soft = require('./softHumanLite');
    finalOut = soft.fixAckOnBareGreeting(finalOut, userMessage);
    finalOut = soft.ensureAckNotBare(finalOut, userMessage);
    // После ensureAck: голое «привет)» на «что делаешь / выходные» → по сути.
    finalOut = soft.fixBareGreetingOnSubstance(finalOut, userMessage);
  } catch (_) {
    /* optional */
  }
  return finalOut;
}

module.exports = {
  lowercaseSentenceStarts,
  finalizeOutgoingReply,
};
