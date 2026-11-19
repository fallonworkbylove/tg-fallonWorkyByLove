from pathlib import Path
import re

ALIVE = (
    "socks5:168.81.64.94:8000:nFBMNd:QEntaw;"
    "socks5:168.81.66.214:8000:nFBMNd:QEntaw;"
    "socks5:168.81.65.185:8000:nFBMNd:QEntaw;"
    "socks5:72.56.182.199:8000:QbQaXK:LMF5Dm;"
    "socks5:72.56.184.168:8000:QbQaXK:LMF5Dm;"
    "socks5:72.56.181.78:8000:QbQaXK:LMF5Dm;"
    "socks5:209.127.51.109:8000:QbQaXK:LMF5Dm;"
    "socks5:23.229.75.249:8000:QbQaXK:LMF5Dm;"
    "socks5:154.30.136.63:8000:QbQaXK:LMF5Dm;"
    "socks5:173.209.232.164:8000:QbQaXK:LMF5Dm;"
    "socks5:173.209.233.42:8000:QbQaXK:LMF5Dm;"
    "socks5:168.80.83.53:8000:BfNHVZ:rZJ9Cn;"
    "socks5:168.80.83.236:8000:BfNHVZ:rZJ9Cn;"
    "socks5:168.80.81.136:8000:BfNHVZ:rZJ9Cn;"
    "socks5:91.216.186.238:8000:BfNHVZ:rZJ9Cn;"
    "socks5:185.168.250.239:8000:SJe5Co:cAwgFL;"
    "socks5:185.168.250.135:8000:SJe5Co:cAwgFL"
)

root = Path(__file__).resolve().parents[1]
for rel in ["scripts/_force_alive_proxy_pm2.sh", "scripts/_deploy_0gm.sh"]:
    p = root / rel
    t = p.read_text(encoding="utf-8")
    t2 = re.sub(r"ALIVE='socks5:[^']+'", f"ALIVE='{ALIVE}'", t, count=1)
    p.write_text(t2, encoding="utf-8")
    print(p.name, "socks", ALIVE.count("socks5:"))
