#!/usr/bin/env python3
"""Dump on old VPS -> download -> upload to NL -> extract."""
import os
import sys
import time
import paramiko

OLD_HOST = os.environ.get("OLD_VPS_HOST", "139.100.237.38")
OLD_PASS = os.environ.get("OLD_VPS_PASS", "")
NL_HOST = os.environ.get("NL_VPS_HOST", "31.57.143.31")
NL_PASS = os.environ.get("NL_VPS_PASS", "")
LOCAL_DUMP_SH = os.environ.get(
    "DUMP_SH",
    r"C:\Users\lox\Desktop\tg-fallonWorkyByLove-main\backend\scripts\_migrate_old_dump.sh",
)
LOCAL_DIR = os.environ.get("LOCAL_MIGRATE_DIR", r"C:\Users\lox\AppData\Local\Temp\nl_migrate")


def ssh(host, password):
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(
        host,
        username="root",
        password=password,
        timeout=40,
        allow_agent=False,
        look_for_keys=False,
    )
    return c


def run(c, cmd, timeout=600):
    print(">>", cmd[:120])
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    if out:
        print(out)
    if err:
        print(err, file=sys.stderr)
    if code != 0:
        raise SystemExit(f"cmd failed {code}: {cmd}")
    return out


def main():
    if not OLD_PASS or not NL_PASS:
        raise SystemExit("Set OLD_VPS_PASS and NL_VPS_PASS")
    os.makedirs(LOCAL_DIR, exist_ok=True)

    old = ssh(OLD_HOST, OLD_PASS)
    sftp = old.open_sftp()
    sftp.put(LOCAL_DUMP_SH, "/tmp/_migrate_old_dump.sh")
    sftp.close()
    run(old, "sed -i 's/\\r$//' /tmp/_migrate_old_dump.sh && bash /tmp/_migrate_old_dump.sh", timeout=900)

    sftp = old.open_sftp()
    for name in ("db.sql", "app.tgz", "backend.env"):
        remote = f"/tmp/nl_migrate/{name}"
        local = os.path.join(LOCAL_DIR, name)
        print("DOWNLOAD", remote, "->", local)
        sftp.get(remote, local)
        print("  bytes", os.path.getsize(local))
    sftp.close()
    old.close()

    nl = ssh(NL_HOST, NL_PASS)
    sftp = nl.open_sftp()
    run(nl, "mkdir -p /tmp/nl_migrate /root/opt/tgbot")
    for name in ("db.sql", "app.tgz", "backend.env"):
        local = os.path.join(LOCAL_DIR, name)
        remote = f"/tmp/nl_migrate/{name}"
        print("UPLOAD", local, "->", remote)
        sftp.put(local, remote)
    sftp.close()

    run(
        nl,
        r"""
set -euo pipefail
cd /root/opt/tgbot
rm -rf tg-miniapp-loverussian
tar -xzf /tmp/nl_migrate/app.tgz
# ensure path name
if [ -d tg-fallonWorkyByLove-main ] && [ ! -d tg-miniapp-loverussian ]; then
  mv tg-fallonWorkyByLove-main tg-miniapp-loverussian
fi
ls -la tg-miniapp-loverussian | head
cp -a /tmp/nl_migrate/backend.env tg-miniapp-loverussian/backend/.env
# force DB to local
python3 - <<'PY'
from pathlib import Path
import re
p=Path('/root/opt/tgbot/tg-miniapp-loverussian/backend/.env')
t=p.read_text(encoding='utf-8',errors='replace')
# keep user/pass/name from old; force host localhost
if re.search(r'^DB_HOST=',t,re.M):
  t=re.sub(r'^DB_HOST=.*$','DB_HOST=127.0.0.1',t,count=1,flags=re.M)
else:
  t+='\nDB_HOST=127.0.0.1\n'
p.write_text(t,encoding='utf-8')
print('DB_HOST forced localhost')
PY
# create DB + import
DB_NAME=$(python3 - <<'PY'
import re
from pathlib import Path
t=Path('/root/opt/tgbot/tg-miniapp-loverussian/backend/.env').read_text(encoding='utf-8',errors='ignore')
m=re.search(r'^DB_NAME=(.*)$',t,re.M)
print((m.group(1).strip() if m else 'telegram_ai_miniapp'))
PY
)
DB_USER=$(python3 - <<'PY'
import re
from pathlib import Path
t=Path('/root/opt/tgbot/tg-miniapp-loverussian/backend/.env').read_text(encoding='utf-8',errors='ignore')
m=re.search(r'^DB_USER=(.*)$',t,re.M)
print((m.group(1).strip() if m else 'tgbot'))
PY
)
DB_PASS=$(python3 - <<'PY'
import re
from pathlib import Path
t=Path('/root/opt/tgbot/tg-miniapp-loverussian/backend/.env').read_text(encoding='utf-8',errors='ignore')
m=re.search(r'^DB_PASSWORD=(.*)$',t,re.M)
print((m.group(1).strip() if m else 'tgbot'))
PY
)
mysql -e "CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -e "CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';"
mysql -e "ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';"
mysql -e "GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost'; FLUSH PRIVILEGES;"
mysql "${DB_NAME}" < /tmp/nl_migrate/db.sql
echo IMPORT_OK
mysql -N -e "SELECT COUNT(*) FROM ${DB_NAME}.accounts;"
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
npm ci --omit=dev || npm install --omit=dev
echo NPM_OK
""",
        timeout=1800,
    )
    nl.close()
    print("BRIDGE_MIGRATE_OK")


if __name__ == "__main__":
    main()
