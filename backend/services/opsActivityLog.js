/**
 * Лента событий для вкладки «Логи» в OPS — как карточки в Telegram-боте:
 * просьба фото/кружка, ГС NFT, лид готов, согласие помочь.
 */

const db = require('../db');

const MAX_MEM = Math.max(100, Math.min(2000, Number(process.env.OPS_ACTIVITY_BUFFER || 500) || 500));
const mem = [];
let schemaReady = null;

const KINDS = new Set([
  'media_miss',
  'media_sent',
  'nft_voice',
  'lead_ready',
  'help_agreed',
]);

async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS ops_activity_log (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        kind VARCHAR(32) NOT NULL,
        title VARCHAR(255) NOT NULL,
        body TEXT NULL,
        account_id INT NULL,
        account_label VARCHAR(255) NULL,
        peer_id VARCHAR(64) NULL,
        peer_label VARCHAR(255) NULL,
        meta_json JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_created (created_at),
        INDEX idx_kind (kind),
        INDEX idx_account (account_id)
      )
    `);
    try {
      await db.execute(
        'CREATE INDEX idx_ops_activity_account ON ops_activity_log (account_id)',
      );
    } catch (_) {
      /* already exists */
    }
  })().catch((err) => {
    schemaReady = null;
    throw err;
  });
  return schemaReady;
}

function pushMem(row) {
  mem.push(row);
  while (mem.length > MAX_MEM) mem.shift();
}

function mapDbRow(row) {
  let meta = null;
  if (row.meta_json) {
    try {
      meta = typeof row.meta_json === 'string' ? JSON.parse(row.meta_json) : row.meta_json;
    } catch (_) {
      meta = null;
    }
  }
  const createdAt = row.created_at
    ? new Date(row.created_at).toISOString()
    : new Date().toISOString();
  return {
    id: Number(row.id),
    kind: row.kind,
    title: row.title,
    body: row.body,
    accountId: row.account_id != null ? Number(row.account_id) : null,
    accountLabel: row.account_label,
    peerId: row.peer_id != null ? String(row.peer_id) : null,
    peerLabel: row.peer_label,
    meta,
    createdAt,
  };
}

/** Тестовые записи smoke-скриптов не должны светиться в ленте воркеров/админки. */
function isSmokeEvent(evt) {
  if (!evt || typeof evt !== 'object') return false;
  const meta = evt.meta && typeof evt.meta === 'object' ? evt.meta : null;
  if (meta && meta.smoke === true) return true;
  const title = String(evt.title || '').trim().toLowerCase();
  if (/^smoke(\s|-|_)/.test(title) || title === 'smoke') return true;
  const label = String(evt.accountLabel || '').trim().toLowerCase();
  if (/^smoke([-_]|$)/.test(label)) return true;
  const aid = Number(evt.accountId);
  if (Number.isFinite(aid) && aid >= 900000 && aid < 1000000) return true;
  return false;
}

function withoutSmoke(events) {
  return (events || []).filter((e) => !isSmokeEvent(e));
}

async function purgeSmokeActivity() {
  try {
    await ensureSchema();
    const [result] = await db.execute(
      `DELETE FROM ops_activity_log
       WHERE LOWER(title) LIKE 'smoke %'
          OR LOWER(title) LIKE 'smoke-%'
          OR LOWER(title) = 'smoke'
          OR LOWER(COALESCE(account_label, '')) LIKE 'smoke-%'
          OR (account_id >= 900000 AND account_id < 1000000)
          OR COALESCE(meta_json, '') LIKE '%"smoke":true%'
          OR COALESCE(meta_json, '') LIKE '%"smoke": true%'`,
    );
    const removed = Number(result?.affectedRows) || 0;
    for (let i = mem.length - 1; i >= 0; i -= 1) {
      if (isSmokeEvent(mem[i])) mem.splice(i, 1);
    }
    return { removed };
  } catch (err) {
    console.error('[opsActivityLog] purgeSmoke failed:', err.message);
    return { removed: 0, error: err.message };
  }
}

/**
 * @param {object} evt
 */
async function pushActivity(evt) {
  const kind = String(evt?.kind || '').trim();
  if (!KINDS.has(kind)) return null;
  const title = String(evt.title || kind).slice(0, 255);
  const body = evt.body != null ? String(evt.body).slice(0, 4000) : null;
  const accountId = evt.accountId != null ? Number(evt.accountId) || null : null;
  const accountLabel = evt.accountLabel != null ? String(evt.accountLabel).slice(0, 255) : null;
  const peerId = evt.peerId != null ? String(evt.peerId).slice(0, 64) : null;
  const peerLabel = evt.peerLabel != null ? String(evt.peerLabel).slice(0, 255) : null;
  const meta = evt.meta && typeof evt.meta === 'object' ? evt.meta : null;

  try {
    await ensureSchema();
    const [result] = await db.execute(
      `INSERT INTO ops_activity_log
        (kind, title, body, account_id, account_label, peer_id, peer_label, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        kind,
        title,
        body,
        accountId,
        accountLabel,
        peerId,
        peerLabel,
        meta ? JSON.stringify(meta) : null,
      ],
    );
    const id = Number(result?.insertId) || 0;
    const row = {
      id,
      kind,
      title,
      body,
      accountId,
      accountLabel,
      peerId,
      peerLabel,
      meta,
      createdAt: new Date().toISOString(),
    };
    if (id) pushMem(row);
    return row;
  } catch (err) {
    console.error('[opsActivityLog] insert failed:', err.message);
    return null;
  }
}

function normalizeAccountIds(accountIds) {
  if (!Array.isArray(accountIds) || !accountIds.length) return null;
  const ids = [
    ...new Set(
      accountIds
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  ];
  return ids.length ? ids : null;
}

async function listActivity({
  limit = 80,
  afterId = 0,
  kind = null,
  accountIds = null,
} = {}) {
  const lim = Math.max(1, Math.min(300, Number(limit) || 80));
  const after = Math.max(0, Number(afterId) || 0);
  const kindFilter = kind && KINDS.has(String(kind)) ? String(kind) : null;
  const ids = normalizeAccountIds(accountIds);

  try {
    await ensureSchema();
    if (after > 0) {
      const params = [after];
      let sql = `SELECT id, kind, title, body, account_id, account_label, peer_id, peer_label, meta_json, created_at
                 FROM ops_activity_log WHERE id > ?`;
      if (kindFilter) {
        sql += ` AND kind = ?`;
        params.push(kindFilter);
      }
      if (ids) {
        sql += ` AND account_id IN (${ids.map(() => '?').join(',')})`;
        params.push(...ids);
      }
      // LIMIT нельзя в prepare на части mysql2 — подставляем уже проверенное число.
      sql += ` ORDER BY id ASC LIMIT ${lim}`;
      const [rows] = await db.execute(sql, params);
      const events = withoutSmoke((rows || []).map(mapDbRow));
      for (const e of events) {
        if (!mem.some((m) => m.id === e.id)) pushMem(e);
      }
      const latestId = events.length
        ? events[events.length - 1].id
        : mem.length
          ? mem[mem.length - 1].id
          : after;
      return { events, latestId, source: 'db' };
    }

    const params = [];
    const where = [];
    let sql = `SELECT id, kind, title, body, account_id, account_label, peer_id, peer_label, meta_json, created_at
               FROM ops_activity_log`;
    if (kindFilter) {
      where.push('kind = ?');
      params.push(kindFilter);
    }
    if (ids) {
      where.push(`account_id IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
    }
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    // Берём с запасом: smoke-строки отфильтруем после чтения.
    sql += ` ORDER BY id DESC LIMIT ${Math.min(300, lim * 3)}`;
    const [rows] = await db.execute(sql, params);
    const events = withoutSmoke((rows || []).map(mapDbRow)).slice(0, lim);
    return {
      events,
      latestId: events.length ? events[0].id : 0,
      source: 'db',
    };
  } catch (err) {
    console.error('[opsActivityLog] list failed:', err.message);
    let fromMem = withoutSmoke([...mem].reverse());
    if (kindFilter) fromMem = fromMem.filter((e) => e.kind === kindFilter);
    if (ids) {
      const allow = new Set(ids);
      fromMem = fromMem.filter((e) => allow.has(Number(e.accountId)));
    }
    if (after > 0) fromMem = fromMem.filter((e) => e.id > after).reverse();
    return {
      events: fromMem.slice(0, lim),
      latestId: mem.length ? mem[mem.length - 1].id : 0,
      source: 'memory',
      error: err.message,
    };
  }
}

module.exports = {
  pushActivity,
  listActivity,
  purgeSmokeActivity,
  isSmokeEvent,
  ensureSchema,
  KINDS: [...KINDS],
};
