#!/usr/bin/env python3
import json
import sys
import urllib.request

phone = sys.argv[1] if len(sys.argv) > 1 else "+79244855206"
body = json.dumps({"phone": phone}).encode()
req = urllib.request.Request(
    "http://127.0.0.1:3000/api/accounts/connect/start",
    data=body,
    headers={"Content-Type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=90) as resp:
        print(resp.read().decode())
except Exception as e:
    if hasattr(e, "read"):
        print(e.read().decode(), file=sys.stderr)
    print("ERR", e, file=sys.stderr)
    sys.exit(1)
