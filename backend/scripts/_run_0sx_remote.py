#!/usr/bin/env python3
from pathlib import Path
import re, os, subprocess, time

SRC = Path("/tmp/0sx")
BASE = Path("/root/opt/tgbot/tg-miniapp-loverussian")
os.chdir(BASE)

pairs = [
    ("softHumanLite.js", "backend/services/softHumanLite.js"),
    ("messageAnalysis.js", "backend/services/messageAnalysis.js"),
    ("aiResponder.js", "backend/services/aiResponder.js"),
    ("humanThinLayer.js", "backend/services/humanThinLayer.js"),
    ("index_frontend.html", "frontend/index.html"),
    ("index_ops.html", "ops-console/app/index.html"),
    ("updates_fe.js", "frontend/updates.js"),
    ("updates_ops.js", "ops-console/app/updates.js"),
    ("CHANGELOG_TG.md", "CHANGELOG_TG.md"),
    ("_smoke_0sx.js", "backend/scripts/_smoke_0sx.js"),
]
for a, b in pairs:
    src = SRC / a
    if src.exists():
        Path(b).write_bytes(src.read_bytes().replace(b"\r\n", b"\n").replace(b"\r", b""))

fe = Path("frontend/index.html").read_text(encoding="utf-8")
assert "## 0sx." in Path("CHANGELOG_TG.md").read_text(encoding="utf-8")
assert "updates.js?v=506" in fe
ma = Path("backend/services/messageAnalysis.js").read_text(encoding="utf-8")
assert "detectVibe" in ma and "detectHerMove" in ma
assert "Прочитай его сообщение как живая девушка" in ma
soft = Path("backend/services/softHumanLite.js").read_text(encoding="utf-8")
assert "ВАЖНО СЕЙЧАС: он устал" not in soft

env = os.environ.copy()
env["OPENAI_API_KEY"] = "sk-test"
env["AUDIT_SMOKE"] = "1"
r = subprocess.run(["timeout", "35", "node", "backend/scripts/_smoke_0sx.js"], env=env, capture_output=True, text=True)
print(r.stdout); print(r.stderr)
if r.returncode != 0:
    raise SystemExit(r.returncode)

text = Path("backend/.env").read_text(encoding="utf-8", errors="ignore")
for key in ["OPENAI_API_KEY", "PROXY_LIST", "OPENAI_PROXY_LIST", "CORS_ORIGIN"]:
    m = re.search(rf"^{re.escape(key)}=(.*)$", text, re.M)
    if m:
        os.environ[key] = m.group(1).strip()
os.environ.pop("AUDIT_SMOKE", None)
key = os.environ.get("OPENAI_API_KEY", "")
if not key or key.startswith(("sk-deploy", "sk-audit", "sk-test")):
    print("REFUSE_OPENAI_FAKE"); raise SystemExit(1)
n = len([x for x in os.environ.get("PROXY_LIST", "").split(";") if x.strip()])
print(f"PROXY_LEN={n}")
if n < 5:
    print("REFUSE_PROXY"); raise SystemExit(1)

subprocess.check_call(["pm2", "restart", "tgbot", "--update-env"])
subprocess.check_call(["pm2", "save"])
time.sleep(12)
subprocess.check_call(["bash", "backend/scripts/_deploy_guard.sh"])
print("DEPLOY_0SX_OK")
