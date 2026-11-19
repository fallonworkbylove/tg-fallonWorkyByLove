import re
import sys
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")
data = open(r"C:\Program Files\Dolphin Anty\resources\app.asar", "rb").read()

m = re.search(rb"zs=\[(.*?)\]", data, re.S)
if m:
    print("zs=", m.group(1)[:2000].decode("utf-8", "replace"))

md5s = sorted(set(re.findall(rb"[a-f0-9]{32}", data)))
print("md5-like count in asar", len(md5s))
# only near local-api
idx = data.find(b"local-api")
chunk = data[max(0, idx - 2000) : idx + 8000]
print("md5 near local-api", re.findall(rb"[a-f0-9]{32}", chunk)[:20])

for key in [b"downloadLocalApi", b".zip", b"md5"]:
    i = chunk.find(key) if key != b"downloadLocalApi" else data.find(key)
    src = chunk if key != b"downloadLocalApi" else data
    if i >= 0:
        print("====", key, "====")
        print(src[i : i + 600].decode("utf-8", "replace"))

ua = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
hash_name = "99c582a3d4d7b3581e3fb7d55e006f8c.zip"
bases = [
    "https://dolphin-anty-cdn.com/local-api/",
    "https://app.dolphin-anty-mirror3.com/local-api/",
    "https://app.dolphin-anty-mirror3.net/local-api/",
    "https://app.dolphin-anty-mirror4.net/local-api/",
    "https://app.dolphin-anty-mirror4.com/local-api/",
    "https://app.dolphin-anty-mirror2.net/local-api/",
    "https://app.api-4-you.com/local-api/",
    "https://app.antynewtraffic.ru/local-api/",
    "https://cdn.anty-stage.com/local-api/",
]
for b in bases:
    u = b + hash_name
    try:
        r = urllib.request.urlopen(urllib.request.Request(u, headers=ua), timeout=12)
        print("OK", r.status, u, "len=", r.getheader("content-length"))
    except Exception as e:
        print("ERR", u, "::", e)
