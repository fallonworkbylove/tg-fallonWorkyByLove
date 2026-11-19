#!/usr/bin/env python3
import datetime
import json
import subprocess
import time
import urllib.error
import urllib.request

for i in range(24):
    h = json.load(urllib.request.urlopen("http://127.0.0.1:3000/api/health"))
    s = h.get("sessions") or {}
    print(
        datetime.datetime.utcnow().strftime("%H:%M:%S"),
        s,
        "up",
        h.get("uptime_s"),
        flush=True,
    )
    if int(s.get("online") or 0) >= 8:
        break
    time.sleep(30)
else:
    raise SystemExit("online_timeout")

print("LISTEN:")
print(subprocess.check_output("ss -lntp | grep -E ':3000|:3306' || true", shell=True).decode())

for path in ["/api/dashboard", "/api/accounts"]:
    try:
        urllib.request.urlopen("http://127.0.0.1:3000" + path, timeout=5)
        print(path, "UNEXPECTED_200")
    except urllib.error.HTTPError as e:
        print(path, "http", e.code)

# headers
req = urllib.request.Request(
    "http://127.0.0.1:3000/api/health",
    method="HEAD",
    headers={"X-Forwarded-Proto": "https"},
)
with urllib.request.urlopen(req, timeout=5) as r:
    hdrs = {k.lower(): v for k, v in r.headers.items()}
for k in (
    "strict-transport-security",
    "content-security-policy",
    "x-frame-options",
    "x-content-type-options",
    "permissions-policy",
):
    print("hdr", k, hdrs.get(k, "MISSING"))

print("LIVE_OK")
