#!/usr/bin/env node
process.env.AUDIT_SMOKE = '1';
process.env.OPENAI_PROXY_LIST = '';
/**
 * Smoke: listActivity filters by accountIds for worker feed.
 * Тестовые записи помечаются meta.smoke и чистятся после прогона.
 */
const path = require('path');
const assert = require('assert');

process.chdir(path.join(__dirname, '..'));

const {
  listActivity,
  pushActivity,
  purgeSmokeActivity,
  isSmokeEvent,
  KINDS,
} = require('../services/opsActivityLog');

async function main() {
  assert(KINDS.includes('media_sent'), 'kind media_sent');
  assert(KINDS.includes('help_agreed'), 'kind help_agreed');

  await purgeSmokeActivity();

  const a = await pushActivity({
    kind: 'media_sent',
    title: 'smoke media',
    body: 'Аккаунт: smoke-a\nСобеседник: @x',
    accountId: 900001,
    accountLabel: 'smoke-a',
    peerId: '1',
    peerLabel: '@x',
    meta: { smoke: true },
  });
  const b = await pushActivity({
    kind: 'help_agreed',
    title: 'smoke lead',
    body: 'Аккаунт: smoke-b\nСобеседник: @y',
    accountId: 900002,
    accountLabel: 'smoke-b',
    peerId: '2',
    peerLabel: '@y',
    meta: { smoke: true },
  });
  assert(a && a.id, 'push a');
  assert(b && b.id, 'push b');
  assert(isSmokeEvent(a), 'a is smoke');
  assert(isSmokeEvent(b), 'b is smoke');

  const onlyA = await listActivity({ limit: 20, accountIds: [900001] });
  assert(Array.isArray(onlyA.events), 'events array');
  assert(
    !onlyA.events.some((e) => e.id === a.id || e.id === b.id),
    'listActivity hides smoke rows from feed',
  );
  assert(
    onlyA.events.every((e) => Number(e.accountId) === 900001),
    'worker filter only own account',
  );

  const empty = await listActivity({ limit: 10, accountIds: [999999999] });
  assert(Array.isArray(empty.events), 'empty ok');
  assert(
    empty.events.every((e) => Number(e.accountId) === 999999999),
    'unknown account empty/filter',
  );

  const purged = await purgeSmokeActivity();
  assert(purged.removed >= 2, 'purge removes smoke rows');

  const after = await listActivity({ limit: 40 });
  assert(
    !(after.events || []).some((e) => isSmokeEvent(e) || /smoke/i.test(String(e.title || ''))),
    'no smoke titles left in feed',
  );

  console.log('OK activity_filter_0ke');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
