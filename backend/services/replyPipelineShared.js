/**
 * Общие куски replyPipeline (вечерний recall / deferred interest) —
 * один вызов вместо копипасты в двух ветках processBufferedMessages.
 */
'use strict';

async function buildEveningRecallHintSafe(accountId, peerId) {
  try {
    return await require('./humanIdeas10').buildEveningRecallHint(accountId, peerId);
  } catch (_) {
    return null;
  }
}

function detectDeferredInterestSafe(replyWithoutReact) {
  try {
    return require('./humanIdeas12').detectDeferredInterest(replyWithoutReact);
  } catch (_) {
    return false;
  }
}

function maybeLifeLagMsSafe(text, opts) {
  try {
    return require('./humanIdeas10').maybeLifeLagMs(text, opts);
  } catch (_) {
    return 0;
  }
}

module.exports = {
  buildEveningRecallHintSafe,
  detectDeferredInterestSafe,
  maybeLifeLagMsSafe,
};
