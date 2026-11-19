import json
import os
import sys
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")
appdata = os.environ["APPDATA"]
cfg = json.load(open(os.path.join(appdata, "dolphin_anty", "config.json"), encoding="utf-8"))
db = json.load(open(os.path.join(appdata, "dolphin_anty", "db.json"), encoding="utf-8"))
tok = cfg.get("token")
print("token type", type(tok), "keys" if isinstance(tok, dict) else "len", len(tok) if isinstance(tok, str) else tok)
print("username", db.get("username"), "has_refresh", bool(db.get("refreshToken")))

ua = {"User-Agent": "Mozilla/5.0"}
for base in [
    "https://dolphin-anty-cdn.com",
    "https://app.dolphin-anty-mirror3.com",
    "https://app.dolphin-anty-mirror4.net",
    "https://app.api-4-you.com",
    "https://app.startmylink.com",
    "https://app.mytraffics.net",
]:
    u = base + "/1MiB_testfile"
    try:
        r = urllib.request.urlopen(urllib.request.Request(u, headers=ua), timeout=8)
        print("OK", r.status, u, "len=", r.getheader("content-length"))
    except Exception as e:
        print("ERR", u, "::", e)

token_str = tok if isinstance(tok, str) else None
if isinstance(tok, dict):
    token_str = tok.get("token") or tok.get("accessToken") or tok.get("value")
    print("token dict keys", list(tok.keys())[:20])

if token_str:
    print("token_len", len(token_str))
    for base in ["https://dolphin-anty-api.com", "https://anty-api.com"]:
        u = base + "/auth/login-with-token"
        body = json.dumps({"token": token_str}).encode()
        req = urllib.request.Request(
            u,
            data=body,
            headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"},
            method="POST",
        )
        try:
            r = urllib.request.urlopen(req, timeout=15)
            print("AUTH OK", base, r.status, r.read(300))
        except Exception as e:
            err_body = ""
            if hasattr(e, "read"):
                try:
                    err_body = e.read(300)
                except Exception:
                    pass
            print("AUTH FAIL", base, e, err_body)
