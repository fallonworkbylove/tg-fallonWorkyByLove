#!/usr/bin/env node
/**
 * Live: dialogs total / archived for Veronika accounts 22 & 26.
 */
require('dotenv').config();

async function main() {
  // Prefer live pool from running process — standalone may need connect.
  const tc = require('../services/telegramClient');
  const { getActiveClient, accountLabel } = require('../services/clientPool');

  for (const accountId of [22, 26]) {
    let client = getActiveClient(accountId);
    if (!client && typeof tc.ensureAccountConnected === 'function') {
      try {
        await tc.ensureAccountConnected(accountId);
      } catch (_) {}
      client = getActiveClient(accountId);
    }
    if (!client && typeof tc.connectAccount === 'function') {
      try {
        await tc.connectAccount(accountId);
      } catch (e) {
        console.log({ accountId, err: e.message });
      }
      client = getActiveClient(accountId);
    }
    if (!client) {
      console.log({ accountId, live: false });
      continue;
    }
    try {
      const dialogs = await client.getDialogs({ limit: 200 });
      const users = (dialogs || []).filter((d) => d.isUser && d.entity && !d.entity.bot && !d.entity.self);
      const active = users.filter((d) => !d.archived);
      const archived = users.filter((d) => d.archived);
      const list = active.slice(0, 40).map((d) => {
        const e = d.entity;
        const uname = e.username ? `@${e.username}` : null;
        const name = [e.firstName, e.lastName].filter(Boolean).join(' ') || null;
        return {
          id: String(e.id),
          uname,
          name,
          unread: d.unreadCount || 0,
        };
      });
      console.log(
        JSON.stringify(
          {
            accountId,
            label: accountLabel(accountId),
            dialogs_user_total: users.length,
            not_archived: active.length,
            archived: archived.length,
            not_archived_sample: list,
            bun187_in_active: list.some((x) => x.uname === '@bun187' || x.id === '5484695633'),
            bun187_in_archived: archived.some(
              (d) => String(d.entity.id) === '5484695633' || d.entity.username === 'bun187',
            ),
          },
          null,
          2,
        ),
      );
    } catch (e) {
      console.log({ accountId, error: e.errorMessage || e.message });
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
