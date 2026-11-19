#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
mkdir -p config /tmp/proxy_probe

# --- residential sticky batch (login) ---
cat >/tmp/proxy_probe/resid.txt <<'EOF'
212.80.7.117:10000:package-49b418f6-user-wj6utulTpDGZ-zone-custom-region-nl-session-b9sTQbVl-sessTime-60:002pTufqq
212.80.7.117:10000:package-49b418f6-user-wj6utulTpDGZ-zone-custom-region-nl-session-i8Psv4tH-sessTime-60-1:003RaCODD
212.80.7.117:10000:package-49b418f6-user-wj6utulTpDGZ-zone-custom-region-nl-session-vMdGZsqQ-sessTime-60-2:001d4HMKK
212.80.7.117:10000:package-49b418f6-user-wj6utulTpDGZ-zone-custom-region-nl-session-jFdeKXHw-sessTime-60-3:002FUHg88
212.80.7.117:10000:package-49b418f6-user-wj6utulTpDGZ-zone-custom-region-nl-session-sPY0bVGz-sessTime-60-4:002EMyikk
212.80.7.117:10000:package-49b418f6-user-wj6utulTpDGZ-zone-custom-region-nl-session-gPz5DmTn-sessTime-60-5:0042pgSOO
212.80.7.117:10000:package-49b418f6-user-wj6utulTpDGZ-zone-custom-region-nl-session-lFEakJtH-sessTime-60-6:001NFTg88
212.80.7.117:10000:package-49b418f6-user-wj6utulTpDGZ-zone-custom-region-nl-session-uL5ncvTd-sessTime-60-7:0030NktMM
212.80.7.117:10000:package-49b418f6-user-wj6utulTpDGZ-zone-custom-region-nl-session-t4u3lBnx-sessTime-60-8:001o4NlAA
212.80.7.117:10000:package-49b418f6-user-wj6utulTpDGZ-zone-custom-region-nl-session-eCIR4i9z-sessTime-60-9:001wEP1oo
212.80.7.117:10000:package-49b418f6-user-wj6utulTpDGZ-zone-custom-region-nl-session-tyGJmSx2-sessTime-60-10:003ShaVxx
212.80.7.117:10000:package-49b418f6-user-wj6utulTpDGZ-zone-custom-region-nl-session-p1hG8PYE-sessTime-60-11:004vNtJQQ
212.80.7.117:10000:package-49b418f6-user-wj6utulTpDGZ-zone-custom-region-nl-session-d3UemhoC-sessTime-60-12:002Djjwuu
212.80.7.117:10000:package-49b418f6-user-wj6utulTpDGZ-zone-custom-region-nl-session-hEIPiGx0-sessTime-60-13:001aE0Pjj
212.80.7.117:10000:package-49b418f6-user-wj6utulTpDGZ-zone-custom-region-nl-session-m1PWRdhx-sessTime-60-14:002C3ETLL
212.80.7.117:10000:package-49b418f6-user-wj6utulTpDGZ-zone-custom-region-nl-session-ffKyJ9VC-sessTime-60-15:004EYjspp
212.80.7.117:10000:package-49b418f6-user-wj6utulTpDGZ-zone-custom-region-nl-session-d3oUTeRG-sessTime-60-16:004FNkRnn
212.80.7.117:10000:package-49b418f6-user-wj6utulTpDGZ-zone-custom-region-nl-session-udNNXBdK-sessTime-60-17:003eCnzAA
212.80.7.117:10000:package-49b418f6-user-wj6utulTpDGZ-zone-custom-region-nl-session-lRZ5vYO7-sessTime-60-18:001jfJavv
212.80.7.117:10000:package-49b418f6-user-wj6utulTpDGZ-zone-custom-region-nl-session-x1imqEkF-sessTime-60-19:003vLyQ00
EOF

# work list expected at /tmp/proxy_probe/work_raw.env
node <<'NODE'
const fs = require('fs');
const { SocksClient } = require('socks');

const DC = [
  { host: '149.154.167.51', port: 443 },
  { host: '149.154.175.54', port: 443 },
  { host: '149.154.167.41', port: 443 },
];
const HTTPS = [{ host: '1.1.1.1', port: 443 }];

function parseWorkEnv(raw) {
  const m = raw.match(/^PROXY_LIST=(.*)$/m);
  const list = [];
  if (!m) return list;
  for (const e of m[1].split(';')) {
    const p = e.trim().split(':');
    if ((p[0] || '').toLowerCase() !== 'socks5') continue;
    list.push({
      host: p[1],
      port: +p[2],
      userId: p[3] || '',
      password: p.slice(4).join(':'),
      line: `socks5:${p[1]}:${p[2]}:${p[3]}:${p.slice(4).join(':')}`,
    });
  }
  return list;
}

function parseResid(raw) {
  return raw
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const p = s.split(':');
      return {
        host: p[0],
        port: +p[1],
        userId: p[2],
        password: p.slice(3).join(':'),
        url: `socks5://${encodeURIComponent(p[2])}:${encodeURIComponent(p.slice(3).join(':'))}@${p[0]}:${p[1]}`,
        line: `socks5:${p[0]}:${p[1]}:${p[2]}:${p.slice(3).join(':')}`,
      };
    });
}

async function ok(px, dests, timeout = 8000) {
  for (const d of dests) {
    try {
      const info = await SocksClient.createConnection({
        proxy: {
          host: px.host,
          port: px.port,
          type: 5,
          userId: px.userId,
          password: px.password,
        },
        command: 'connect',
        destination: d,
        timeout,
      });
      try {
        info.socket.destroy();
      } catch (_) {}
      return true;
    } catch (_) {}
  }
  return false;
}

(async () => {
  const workRaw = fs.readFileSync('/tmp/proxy_probe/work_raw.env', 'utf8');
  const work = parseWorkEnv(workRaw);
  const resid = parseResid(fs.readFileSync('/tmp/proxy_probe/resid.txt', 'utf8'));

  const tgOk = [];
  const httpsOk = [];
  for (const px of work) {
    const tg = await ok(px, DC);
    const https = tg ? true : await ok(px, HTTPS);
    console.log(tg ? 'WORK_TG_OK' : https ? 'WORK_HTTPS' : 'WORK_DEAD', px.host + ':' + px.port);
    if (tg) tgOk.push(px);
    else if (https) httpsOk.push(px);
  }

  const loginKeep = [];
  let residDc = 0,
    residSocks = 0;
  for (const px of resid) {
    const socks = await ok(px, HTTPS, 10000);
    const dc = socks ? await ok(px, DC, 10000) : false;
    let v = 'RESID_DEAD';
    if (dc) {
      v = 'RESID_DC_OK';
      residDc++;
    } else if (socks) {
      v = 'RESID_SOCKS';
      residSocks++;
    }
    console.log(v, px.host + ':' + px.port, String(px.userId).slice(-18));
    // keep all that at least SOCKS; also keep dead ones? user asked to add — keep SOCKS+ survivors, and if none, still write full list for whitelist retry
    if (socks || dc) loginKeep.push(px);
  }

  // If none socks from NL, still install full resid list (user may whitelist later) + note
  const loginOut = loginKeep.length ? loginKeep : resid;

  const proxyList = tgOk.map((p) => p.line).join(';');
  const openaiList = [...tgOk, ...httpsOk]
    .map((p) => p.line)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(';');

  fs.writeFileSync(
    'config/proxies-login.txt',
    '# NL resid sticky 0ho ' +
      new Date().toISOString() +
      '\n' +
      loginOut.map((p) => p.url).join('\n') +
      '\n',
  );
  fs.writeFileSync('/tmp/proxy_probe/PROXY_LIST.txt', proxyList);
  fs.writeFileSync('/tmp/proxy_probe/OPENAI_PROXY_LIST.txt', openaiList);
  fs.writeFileSync(
    '/tmp/proxy_probe/summary.json',
    JSON.stringify(
      {
        work_total: work.length,
        work_tg_ok: tgOk.length,
        work_https_only: httpsOk.length,
        resid_total: resid.length,
        resid_dc_ok: residDc,
        resid_socks: residSocks,
        login_written: loginOut.length,
        proxy_len: tgOk.length,
      },
      null,
      2,
    ),
  );
  console.log('SUMMARY', JSON.stringify({
    work_tg_ok: tgOk.length,
    proxy_len: tgOk.length,
    resid_dc: residDc,
    resid_socks: residSocks,
    login_written: loginOut.length,
  }));
  if (tgOk.length < 5) {
    console.error('REFUSE_PROXY need >=5 TG_OK');
    process.exit(2);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
NODE

python3 - <<'PY'
import re
from pathlib import Path
p=Path('.env')
t=p.read_text(encoding='utf-8',errors='replace')
pl=Path('/tmp/proxy_probe/PROXY_LIST.txt').read_text().strip()
ol=Path('/tmp/proxy_probe/OPENAI_PROXY_LIST.txt').read_text().strip()
def setk(text,key,val):
    if re.search(rf'^{re.escape(key)}=',text,re.M):
        return re.sub(rf'^{re.escape(key)}=.*$',f'{key}={val}',text,count=1,flags=re.M)
    return text.rstrip()+f'\n{key}={val}\n'
t=setk(t,'PROXY_LIST',pl)
t=setk(t,'OPENAI_PROXY_LIST',ol)
p.write_text(t,encoding='utf-8')
print('env PROXY_LEN', len([x for x in pl.split(';') if x.strip()]))
print('env OPENAI_LEN', len([x for x in ol.split(';') if x.strip()]))
print(Path('/tmp/proxy_probe/summary.json').read_text())
PY

# empty proxies.txt (env-only)
echo '# env-only' > config/proxies.txt

# reload env into pm2
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['OPENAI_API_KEY','PROXY_LIST','OPENAI_PROXY_LIST','BOT_TOKEN','PORT','DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','DB_PORT','CORS_ORIGIN','ADMIN_CONSOLE_TOKEN','TELEGRAM_AUTH_BYPASS','TELEGRAM_AUTH_BYPASS_FORCE','TELEGRAM_API_ID','TELEGRAM_API_HASH','ADMIN_ALERT_CHAT_ID']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"
export TELEGRAM_AUTH_BYPASS=false TELEGRAM_AUTH_BYPASS_FORCE=false DB_HOST=127.0.0.1
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo PROXY_LEN=$n
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }

pm2 restart tgbot --update-env
pm2 save
sleep 10
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];e=p["pm2_env"];print({"status":e.get("status"),"PROXY":len([x for x in (e.get("PROXY_LIST")or"").split(";")if x.strip()]),"OPENAI_P":len([x for x in (e.get("OPENAI_PROXY_LIST")or"").split(";")if x.strip()])})'
wc -l config/proxies-login.txt
echo APPLY_PROXIES_0HO_OK
