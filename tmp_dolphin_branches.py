import re
import sys
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")
bg = open(
    r"C:\Users\lox\AppData\Local\Temp\dolphin_asar_extract\js_dist\background.js",
    encoding="utf-8",
    errors="replace",
).read()

for key in ["get branches", "branches", "branch", "releaseVersion", "soft/electron"]:
    print(key, len(re.findall(re.escape(key), bg, flags=re.I)))

i = bg.find("Error of get branches request")
print("\n=== branches error ctx ===")
print(bg[i - 1500 : i + 800])

print("\n=== probe likely branch endpoints ===")
ua = {
    "User-Agent": "Mozilla/5.0",
    "X-Anty-App-Version": "2026.189.257",
    "Accept": "application/json",
}
paths = [
    "/branches",
    "/branch",
    "/electron/branches",
    "/soft/branches",
    "/client/branches",
    "/frontend/branches",
    "/releases/branches",
    "/anty/branches",
    "/download/branches",
    "/update/branches",
]
for base in ["https://dolphin-anty-api.com", "https://anty-api.com"]:
    for p in paths:
        u = base + p
        try:
            r = urllib.request.urlopen(
                urllib.request.Request(u, headers=ua), timeout=8
            )
            print("OK", r.status, u, r.read(120))
        except Exception as e:
            code = getattr(e, "code", None)
            if code and code != 404:
                body = b""
                try:
                    body = e.read(100)
                except Exception:
                    pass
                print(code, u, body)
