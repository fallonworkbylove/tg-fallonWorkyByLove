#!/usr/bin/env python3
"""Deprecated: do NOT bake ADMIN_CONSOLE_TOKEN into the APK.

0hi+: operator enters the key once in OPS Settings (WebView localStorage
on ops-loverussian.duckdns.org). This script only writes an empty stub
so old build steps that expect the file do not fail.
"""
import json
from pathlib import Path

out = {"token": "", "baseUrl": "https://loverussian.duckdns.org", "baked": False}
Path("/tmp/ops-secret.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
print("SECRET_EMPTY_NO_BAKE")
