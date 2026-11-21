#!/usr/bin/env python3
import subprocess, sys
HOST = "root@loverussian.duckdns.org"
REMOTE = r"""
cd /root/opt/tgbot/tg-miniapp-loverussian
grep -q interpretMeaning backend/services/messageAnalysis.js && echo INTERPRET_OK
grep -q 'ОН ИМЕЕТ В ВИДУ' backend/services/messageAnalysis.js && echo MEANING_HINT_OK
grep -q 'Сначала понимает смысл' frontend/updates.js && echo UPD_OK
grep -q '## 0sw.' CHANGELOG_TG.md && echo CL_OK
grep 'updates.js?v=' frontend/index.html | head -1
echo PROBE_0SW_OK
"""
sys.exit(subprocess.run(["ssh", "-o", "ConnectTimeout=30", HOST, REMOTE]).returncode)
