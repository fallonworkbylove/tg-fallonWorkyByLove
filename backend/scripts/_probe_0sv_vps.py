#!/usr/bin/env python3
"""Local runner: ssh probe for 0sv post-add audit."""
import subprocess
import sys

HOST = "root@loverussian.duckdns.org"
REMOTE = r"""
set -e
cd /root/opt/tgbot/tg-miniapp-loverussian
test -f backend/services/messageAnalysis.js && echo MA_OK
grep -c buildAnalysisHint backend/services/aiResponder.js || true
grep -c buildSoftHintFragment backend/services/softHumanLite.js || true
grep 'updates.js?v=' frontend/index.html | head -1
grep -q 'Лучше понимает' frontend/updates.js && echo FE_UPD_OK
grep -q '## 0sv.' CHANGELOG_TG.md && echo CL_OK
pm2 jlist | python3 -c "import sys,json;d=json.load(sys.stdin);p=d[0]['pm2_env'];pl=str(p.get('PROXY_LIST') or '');print('status',p.get('status'),'PROXY',len([x for x in pl.split(';') if x.strip()]))"
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|REFUSE_PROXY' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -8 || true
echo PROBE_0SV_OK
"""
r = subprocess.run(["ssh", "-o", "ConnectTimeout=30", HOST, REMOTE], check=False)
sys.exit(r.returncode)
