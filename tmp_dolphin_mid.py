import json
import sys
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")

# exact machineId from dolphin stdout
mid = "eyJtYWNoaW5lSWQiOiI5NjQxMmI3NDNkN2YxNjBlNWY1MGI5ZDJkZGQ4ZjU2NGRiNWQ2N2RmYTI5YTUxODAxODI3YWExMzdlNjJjZWY5NmY5MjJlNDZhZjkxM2U4OTIyYzM1MGZiNDEzN2NlM2UiLCJtYWNoaW5lTmFtZSI6IkRFU0tUT1AtUkNUM05UNCIsInBsYXRmb3JtIjoid2luMzIifQ=="

hosts = [
    "https://dolphin-anty-api.com",
    "https://api.dolphin-anty-api-cf.com",
    "https://dolphin-anty-mirror3.com",
    "https://dolphin-anty-mirror3.net",
    "https://dolphin-anty-mirror4.net",
    "https://dolphin-anty-mirror4.com",
    "https://dolphin-anty-mirror2.net",
    "https://api-4-you.com",
    "https://anty-api.com",
]

# read encrypted token length only
cfg = json.load(
    open(
        __import__("os").environ["APPDATA"] + r"\dolphin_anty\config.json",
        encoding="utf-8",
    )
)
tok = cfg.get("token")
print("token type", type(tok))

for base in hosts:
    url = f"{base}/branches?machineId={mid}"
    headers = {
        "User-Agent": "axios/1.6.8",
        "Accept": "application/json, text/plain, */*",
        "MachineId": mid,
    }
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=15)
        body = r.read(80)
        print("OK", r.status, base, body)
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, base, e.read(120))
    except Exception as e:
        print("ERR", base, e)
