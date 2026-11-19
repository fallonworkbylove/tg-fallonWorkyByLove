/**
 * Единый реестр humanIdeas10–18: hints + postfilters.
 * Новые фичи — слот сюда, не разрозненные require в humanHardening.
 */
'use strict';

/** @type {{ id: string, apply?: Function, hints?: Function }[]} */
const IDEAS_SLOTS = [
  {
    id: '10',
    apply: (out, history) => {
      const m = require('./humanIdeas10');
      return m.stripCoffeeSeriesWalkCombo(out, history);
    },
    hints: (history, text, opts) => {
      const hobby = require('./humanIdeas10').altHobbyHint(opts?.accountId);
      return hobby || null;
    },
  },
  {
    id: '11',
    apply: (out, history, userMessage) =>
      require('./humanIdeas11').applyIdeas11Postfilters(out, history, userMessage),
    hints: (history, text) => require('./humanIdeas11').buildIdeas11Hints(history, text),
  },
  {
    id: '12',
    apply: (out, history, userMessage, accountId, peerId) =>
      require('./humanIdeas12').applyIdeas12Postfilters(
        out,
        history,
        userMessage,
        accountId,
        peerId,
      ),
    hints: (history, text) => require('./humanIdeas12').buildIdeas12Hints(history, text),
  },
  {
    id: '13',
    apply: (out, history, userMessage) =>
      require('./humanIdeas13').applyIdeas13Postfilters(out, history, userMessage),
    hints: (history, text) => require('./humanIdeas13').buildIdeas13Hints(history, text),
  },
  {
    id: '14',
    apply: (out, history, userMessage, accountId, peerId) =>
      require('./humanIdeas14').applyIdeas14Postfilters(
        out,
        history,
        userMessage,
        accountId,
        peerId,
      ),
    hints: (history, text, opts) =>
      require('./humanIdeas14').buildIdeas14Hints(history, text, {
        systemPrompt: opts?.systemPrompt,
        memoryHint: opts?.memoryHint,
      }),
  },
  {
    id: '15',
    apply: (out, history, userMessage, _a, _p, systemPrompt) =>
      require('./humanIdeas15').applyIdeas15Postfilters(
        out,
        history,
        userMessage,
        systemPrompt,
      ),
    hints: (_h, text) => require('./humanIdeas15').buildIdeas15Hints(text),
  },
  {
    id: '16',
    apply: (out, history, userMessage) =>
      require('./humanIdeas16').applyIdeas16Postfilters(out, history, userMessage),
    hints: (_h, text) => require('./humanIdeas16').buildIdeas16Hints(text),
  },
  {
    id: '17',
    apply: (out, history, userMessage, _a, _p, systemPrompt) =>
      require('./humanIdeas17').applyIdeas17Postfilters(
        out,
        history,
        userMessage,
        systemPrompt,
      ),
    hints: (history, text, opts) =>
      require('./humanIdeas17').buildIdeas17Hints(history, text, {
        systemPrompt: opts?.systemPrompt,
      }),
  },
  {
    id: '18',
    apply: (out, history, userMessage) =>
      require('./humanIdeas18').applyIdeas18Postfilters(out, history, userMessage),
    hints: (history, text, opts) =>
      require('./humanIdeas18').buildIdeas18Hints(history, text, {
        systemPrompt: opts?.systemPrompt,
      }),
  },
];

function applyIdeasRegistryPostfilters(
  reply,
  history,
  userMessage,
  accountId = null,
  peerId = null,
  systemPrompt = null,
) {
  let out = reply;
  for (const slot of IDEAS_SLOTS) {
    if (typeof slot.apply !== 'function') continue;
    try {
      out = slot.apply(out, history, userMessage, accountId, peerId, systemPrompt);
    } catch (_) {
      /* optional module */
    }
  }
  return out;
}

/** Собрать hint-строки из слотов (для buildHardeningHints). */
function buildIdeasRegistryHints(history, text, opts = {}) {
  const parts = [];
  for (const slot of IDEAS_SLOTS) {
    if (typeof slot.hints !== 'function') continue;
    try {
      const h = slot.hints(history, text, opts);
      if (h) parts.push(h);
    } catch (_) {
      /* optional */
    }
  }
  return parts.length ? parts.join('\n') : null;
}

module.exports = {
  IDEAS_SLOTS,
  applyIdeasRegistryPostfilters,
  buildIdeasRegistryHints,
};
