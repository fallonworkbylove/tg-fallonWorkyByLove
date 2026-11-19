#!/usr/bin/env python3
import time, urllib.request, json, datetime, sys

for i in range(24):
    h = json.load(urllib.request.urlopen("http://127.0.0.1:3000/api/health"))
    sess = h.get("sessions") or {}
    print(
        datetime.datetime.utcnow().strftime("%H:%M:%S"),
        sess,
        "up",
        h.get("uptime_s"),
        flush=True,
    )
    if int(sess.get("online") or 0) >= 1:
        sys.exit(0)
    time.sleep(30)
sys.exit(1)
