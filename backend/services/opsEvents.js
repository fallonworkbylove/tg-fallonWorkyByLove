/**
 * Лёгкие ops-события без циклов require (clientPool → opsQuality).
 */
'use strict';

const listeners = {
  authKeyDuplicated: [],
};

function on(event, fn) {
  if (!listeners[event]) listeners[event] = [];
  listeners[event].push(fn);
}

function emit(event, ...args) {
  for (const fn of listeners[event] || []) {
    try {
      fn(...args);
    } catch (_) {
      /* optional */
    }
  }
}

function noteAuthKeyDuplicated(accountId) {
  emit('authKeyDuplicated', accountId);
}

module.exports = { on, emit, noteAuthKeyDuplicated };
