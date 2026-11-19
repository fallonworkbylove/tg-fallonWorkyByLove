'use strict';
const fs = require('fs');
const path = require('path');

const oldPath = path.join(__dirname, '../config/proxies-login.txt');
const newPath = process.argv[2];
if (!newPath) {
  console.error('Usage: node _merge_login_proxies.js <new-proxies.txt>');
  process.exit(1);
}

function parseLine(line) {
  const s = String(line || '').trim();
  if (!s || s.startsWith('#')) return null;

  const urlMatch = s.match(
    /^(socks5?):\/\/(?:([^:@/?#]+):([^@/?#]*)@)?([^:/?#]+):(\d+)\/?$/i,
  );
  if (urlMatch) {
    const [, , user, pass, host, port] = urlMatch;
    const lineOut = user
      ? `socks5://${user}:${pass || ''}@${host}:${port}`
      : `socks5://${host}:${port}`;
    return { key: `${host.toLowerCase()}:${port}`, line: lineOut };
  }

  const parts = s.split(':');
  if (/^socks5?$/i.test(parts[0] || '') && parts.length >= 3) {
    const host = parts[1];
    const port = parts[2];
    const user = parts[3];
    const pass = parts.slice(4).join(':');
    const lineOut = user
      ? `socks5://${user}:${pass}@${host}:${port}`
      : `socks5://${host}:${port}`;
    return { key: `${host.toLowerCase()}:${port}`, line: lineOut };
  }

  return { key: s.toLowerCase(), line: s };
}

function load(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map(parseLine)
    .filter(Boolean);
}

const oldRows = load(oldPath);
const newRows = load(newPath);
const seen = new Map();
for (const r of oldRows) {
  if (!seen.has(r.key)) seen.set(r.key, r.line);
}
const before = seen.size;
let added = 0;
for (const r of newRows) {
  if (!seen.has(r.key)) {
    seen.set(r.key, r.line);
    added += 1;
  }
}

const out = [...seen.values()].join('\n') + '\n';
fs.writeFileSync(oldPath, out);

const hosts = [...new Set([...seen.keys()].map((k) => k.split(':')[0]))];
console.log(
  JSON.stringify(
    {
      oldLines: oldRows.length,
      oldUnique: before,
      newLines: newRows.length,
      newAdded: added,
      totalUnique: seen.size,
      hosts,
    },
    null,
    2,
  ),
);
