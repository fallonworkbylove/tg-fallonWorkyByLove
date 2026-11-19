require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  PROXY_POOL,
  LOGIN_PROXY_POOL,
  proxyLabel,
  parseProxyEntry,
} = require('../services/proxyPools');

function countFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { path: filePath, missing: true, lines: 0, parsed: 0 };
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  const parsed = lines.map(parseProxyEntry).filter(Boolean);
  return {
    path: filePath,
    lines: lines.length,
    parsed: parsed.length,
    sample: parsed.slice(0, 5).map(proxyLabel),
  };
}

const workFile = process.env.PROXY_FILE
  ? path.resolve(process.env.PROXY_FILE)
  : path.join(__dirname, '..', 'config', 'proxies.txt');
const loginFile = process.env.PROXY_FILE_LOGIN
  ? path.resolve(process.env.PROXY_FILE_LOGIN)
  : path.join(__dirname, '..', 'config', 'proxies-login.txt');

const envList = String(process.env.PROXY_LIST || '')
  .split(/[;\n\r]+/)
  .map((s) => s.trim())
  .filter(Boolean);
const envLogin = String(process.env.PROXY_LIST_LOGIN || '')
  .split(/[;\n\r]+/)
  .map((s) => s.trim())
  .filter(Boolean);

console.log(
  JSON.stringify(
    {
      workPool: PROXY_POOL.length,
      workLabels: PROXY_POOL.map(proxyLabel),
      loginPool: LOGIN_PROXY_POOL.length,
      loginSample: LOGIN_PROXY_POOL.slice(0, 3).map(proxyLabel),
      env: {
        PROXY_LIST_count: envList.length,
        PROXY_LIST_LOGIN_count: envLogin.length,
        PROXY_FILE: process.env.PROXY_FILE || null,
        PROXY_FILE_LOGIN: process.env.PROXY_FILE_LOGIN || null,
        PROXY_IP: process.env.PROXY_IP || null,
        PROXY_TYPE: process.env.PROXY_TYPE || null,
      },
      files: {
        work: countFile(workFile),
        login: countFile(loginFile),
      },
    },
    null,
    2,
  ),
);
