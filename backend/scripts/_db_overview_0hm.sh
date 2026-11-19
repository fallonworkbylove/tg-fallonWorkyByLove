#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
python3 - <<'PY'
import os, re, subprocess
from pathlib import Path
env = Path('.env').read_text(encoding='utf-8', errors='ignore')
def get(k, d=''):
    m = re.search(rf'^{re.escape(k)}=(.*)$', env, re.M)
    return (m.group(1).strip() if m else d)
host=get('DB_HOST','127.0.0.1'); user=get('DB_USER'); pw=get('DB_PASSWORD'); db=get('DB_NAME'); port=get('DB_PORT','3306')
print(f'DB {user}@{host}:{port}/{db}')
sql = r'''
SELECT VERSION() AS ver;
SELECT COUNT(*) AS tables_cnt FROM information_schema.tables WHERE table_schema=DATABASE();
SELECT table_name, table_rows, ROUND(data_length/1024/1024,2) AS data_mb, ROUND(index_length/1024/1024,2) AS idx_mb
FROM information_schema.tables WHERE table_schema=DATABASE()
ORDER BY (data_length+index_length) DESC LIMIT 40;
SELECT 'accounts' t, COUNT(*) c FROM accounts
UNION ALL SELECT 'users', COUNT(*) FROM users
UNION ALL SELECT 'chat_logs', COUNT(*) FROM chat_logs
UNION ALL SELECT 'archived_peers', COUNT(*) FROM archived_peers
UNION ALL SELECT 'cleared_peers', COUNT(*) FROM cleared_peers
UNION ALL SELECT 'help_requests', COUNT(*) FROM help_requests
UNION ALL SELECT 'openai_usage_log', COUNT(*) FROM openai_usage_log
UNION ALL SELECT 'peer_memory_facts', COUNT(*) FROM peer_memory_facts
UNION ALL SELECT 'peer_profiles', COUNT(*) FROM peer_profiles
UNION ALL SELECT 'daily_photo_sends', COUNT(*) FROM daily_photo_sends
UNION ALL SELECT 'nft_voice_schedule', COUNT(*) FROM nft_voice_schedule
UNION ALL SELECT 'ops_activity_log', COUNT(*) FROM ops_activity_log;
SHOW COLUMNS FROM accounts;
SHOW COLUMNS FROM users;
SHOW COLUMNS FROM chat_logs;
'''
# try common core tables; ignore missing
cmd=['mysql','-h',host,'-P',port,'-u',user,f'-p{pw}',db,'-N','-e',sql]
r=subprocess.run(cmd,capture_output=True,text=True)
print(r.stdout)
if r.returncode:
    print('STDERR', r.stderr[:2000])
PY
