#!/usr/bin/env python3
"""Проверка ноды Happ для Dolphin. Туннель НЕ выключаем.
Меняй сервер, пока не будет READY.
"""
import sys
import time
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")

CHECKS = [
    ("API health", "https://dolphin-anty-api.com/health", "json"),
    ("CDN 1MiB ", "https://dolphin-anty-cdn.com/1MiB_testfile", "1mib"),
    ("m4 1MiB  ", "https://app.dolphin-anty-mirror4.net/1MiB_testfile", "1mib"),
    ("m3 1MiB  ", "https://app.dolphin-anty-mirror3.com/1MiB_testfile", "1mib"),
]


def check(url: str, kind: str) -> tuple[bool, str]:
    try:
        r = urllib.request.urlopen(url, timeout=8)
        body = r.read()
        if kind == "json":
            ok = r.status == 200 and b"ok" in body.lower()
            return ok, f"OK {r.status} {body[:60]!r}"
        if kind == "1mib":
            n = len(body)
            # реальный файл ~1MiB; пустой 200 = битая нода/CDN
            ok = r.status == 200 and n >= 500_000
            return ok, f"OK status={r.status} bytes={n}"
        return True, f"OK {r.status}"
    except Exception as e:
        return False, f"ERR {e}"


print("Happ ON. Меняй ноду. Ctrl+C — выход.\n")
while True:
    ts = time.strftime("%H:%M:%S")
    print(f"--- {ts} ---")
    results = []
    for name, url, kind in CHECKS:
        ok, msg = check(url, kind)
        results.append(ok)
        print(f"  {'+' if ok else '-'} {name}: {msg}")
    api_ok, cdn_ok = results[0], any(results[1:])
    if api_ok and cdn_ok:
        print("\n>>> READY: запускай Dolphin Anty <<<\n")
    elif api_ok and not cdn_ok:
        print("  → API ок, но CDN testfile пустой/битый — смени ноду\n")
    else:
        print("  → смени ноду Happ\n")
    time.sleep(5)
