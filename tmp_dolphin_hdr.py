import base64
import json
import sys
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")
mid_obj = {
    "machineId": "96412b743d7f160e5f50b9d2ddd8f564db5d67dfa29a51801827aa137e62cef96f922e46af913e8922c350fb4137ce3e",
    "machineName": "DESKTOP-RCT3NT4",
    "platform": "win32",
}
mid = base64.b64encode(json.dumps(mid_obj, separators=(",", ":")).encode()).decode()

header_sets = [
    {"User-Agent": "Mozilla/5.0"},
    {"User-Agent": "axios/1.7.7"},
    {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "X-Anty-App-Version": "2026.189.257",
        "MachineId": mid,
        "Accept": "application/json",
    },
]
hosts = [
    "https://dolphin-anty-api.com/branches",
    "https://dolphin-anty-mirror4.net/branches",
    "https://api.dolphin-anty-api-cf.com/branches",
    "https://anty-api.com/branches",
]
for u in hosts:
    for h in header_sets:
        url = f"{u}?machineId={urllib.request.quote(mid)}"
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=12)
            print("OK", r.status, u, h.get("User-Agent", "")[:40], r.read(50))
        except Exception as e:
            print("FAIL", u, h.get("User-Agent", "")[:40], e)
    print("---")
