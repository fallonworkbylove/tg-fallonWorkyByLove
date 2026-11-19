/**
 * Общий выход для smoke: закрыть mysql pool и process.exit,
 * чтобы full/hard audit не ловил ложный P0 на open handles.
 */
'use strict';

async function finishSmoke(ok, label) {
  try {
    const db = require('../db');
    // db.js экспортирует mysql pool напрямую.
    if (db && typeof db.end === 'function') await db.end();
  } catch (_) {
    /* optional */
  }
  if (ok) {
    if (label) console.log(label);
    process.exit(0);
  }
  process.exit(1);
}

function installSmokeExit() {
  process.on('beforeExit', () => {
    try {
      const db = require('../db');
      if (db && typeof db.end === 'function') db.end();
    } catch (_) {
      /* optional */
    }
  });
}

module.exports = { finishSmoke, installSmokeExit };
